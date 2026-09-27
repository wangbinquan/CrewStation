import type { ProjectId, RuntimeImageExecutionSnapshot, RuntimeInitializationStatus, ServiceId, TaskId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { newResourceId } from '@crewstation/kernel';
import { createFakeK8sClient, pvcObject, Resources, taskPodObject } from '@crewstation/k8s';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';

export const imageSnapshot = (): RuntimeImageExecutionSnapshot => ({ versionId: newResourceId(), image: `registry/runtime@sha256:${'a'.repeat(64)}`, digest: `sha256:${'a'.repeat(64)}`, architecture: 'linux/arm64', validationId: newResourceId(), initializerDigest: `sha256:${'b'.repeat(64)}`, initializer: { steps: [], env: {}, secrets: [] }, tools: [], selectionSource: 'request' });

export async function runtimeImageFixture(pinTaskImage?: (image: string) => Promise<string>, creation: 'ledger' | 'owner' = 'ledger') {
  const tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, taskRuntimeMigrations]);
  const k8s = createFakeK8sClient(), projectId = newResourceId() as ProjectId, serviceId = newResourceId() as ServiceId;
  const resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 8 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
  const owner = resources.api.owner('task-runtime'), profile = { id: newResourceId(), name: 'test', cpu: '1', memory: '1Gi', storage: '2Gi', description: '' };
  let now = new Date();
  const protocol = { supported: true };
  const statuses = new Map<TaskId, RuntimeInitializationStatus>();
  const uow = drizzleUnitOfWork(tdb.db);
  const runtime = createTaskRuntimeModule({
    imageProbeLeases: { port: resources.api.leases, holder: 'runtime-image-test' },
    db: tdb.db, k8s, clock: { now: () => now }, authorizer: { authorize: async () => {} }, isAdmin: async () => true, quotas: { quotaLimit: async () => 8 }, creation: creation === 'ledger' ? 'ledger' : undefined,
    ledger: { within: (tx) => owner.within(tx as object), live: async () => (await resources.api.list({})).filter((r) => r.owner.module === 'task-runtime'), occupancy: resources.api.occupancy },
    profiles: { listTaskProfiles: async () => [profile], getTaskProfile: async () => profile },
    services: { resolveServiceById: async () => ({ projectId, namespace: 'cs-runtime-image', slug: 'runtime-image', name: 'runtime-image' }) },
    sources: { ...(pinTaskImage ? { pinTaskImage } : {}), configEnv: async () => ({ GREETING: 'hello' }), dataEnv: async () => ({}), taskDataEnv: async () => ({}) },
    testRunner: { sendCommand: async (id, command) => command.type === 'exec' ? { exitCode: 0, stdout: '10001\n' } : statuses.get(id), listEvents: async () => [], connectionStatus: async () => ({ connected: true, capabilities: { protocols: [], pty: false, preview: false, ...(protocol.supported ? { runtimeInitialization: 1 as const } : {}) } }) },
    settings: { taskImage: 'platform:fallback', sessionUrl: 'ws://session/runner', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: profile.id, userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' },
  });
  const load = async (id: TaskId) => (await uow.read.environments.getById(id))!;
  const bind = async (id: TaskId, connect = true) => {
    const env = await load(id), values = await runtime.api.runnerValues(id);
    const pod = await k8s.create(taskPodObject({ name: env.podName, namespace: env.namespace, taskId: id, workload: env.kind === 'business' ? 'business-task' : env.kind, project: 'runtime-image', service: 'runtime-image', image: env.render!.image,
      workerUid: 10001, resources: profile, workVolume: { pvc: env.pvcName }, ...(env.render?.runtimeImage ? { runtimeInitialization: true } : {}) }));
    await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { spec: { nodeName: 'worker-one' }, status: { phase: 'Running' } });
    if (!env.native) {
      await k8s.create(pvcObject({ name: env.pvcName, namespace: env.namespace, size: '2Gi', labels: { 'crewstation.io/task': id } }));
      await k8s.mergePatch(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace, { status: { phase: 'Bound' } });
    }
    await runtime.api.bindWorkload(id, pod.metadata.uid!);
    if (connect) await runtime.api.onRunnerConnected(id, values.CS_RUNNER_TOKEN!);
    return { pod, values };
  };
  const status = async (id: TaskId, state: RuntimeInitializationStatus['state']) => {
    const env = await load(id), image = env.render!.runtimeImage!, containerIdentity = `${env.native?.podUid ?? env.podUid}/1234`;
    const executionId = new Bun.CryptoHasher('sha256').update(`${id}/${env.render!.start}/${containerIdentity}/${image.versionId}/${image.initializerDigest}`).digest('hex');
    statuses.set(id, { enabled: true, state, executionId, containerIdentity, versionId: image.versionId, steps: [], checks: [] });
  };
  return { protocol, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, runtime, resources, uow, k8s, projectId, serviceId, load, bind, statuses, status, close: () => tdb.drop() };
}
