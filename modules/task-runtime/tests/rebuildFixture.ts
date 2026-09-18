import type { ProjectId, RebuildDevSessionRequest, ServiceId, TaskProfileDto } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { queueMigrations } from '@crewstation/queue';
import type { Worker } from '@crewstation/queue';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';

export async function rebuildFixture(options: { running?: boolean; kind?: 'dev-session' | 'business' } = {}) {
  const tdb = await createTestDatabase([eventbusMigrations, queueMigrations, taskRuntimeMigrations]);
  const k8s = createFakeK8sClient();
  const projectId = `prj_${'a'.repeat(32)}` as ProjectId, serviceId = `svc_${'a'.repeat(32)}` as ServiceId;
  let time = Date.parse('2026-09-15T10:00:00Z');
  const state = { quota: 2, checkoutCalls: 0, profiles: [{ name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi', description: '' },
    { name: 'coding-large', cpu: '2', memory: '4Gi', storage: '20Gi', description: '' }] as TaskProfileDto[] };
  const runtime = createTaskRuntimeModule({ db: tdb.db, k8s, authorizer: { authorize: async () => {} }, isAdmin: async () => true,
    quotas: { quotaLimit: async () => state.quota }, profiles: { listTaskProfiles: async () => state.profiles, getTaskProfile: async (name) => state.profiles.find((p) => p.name === name) },
    services: { resolveServiceById: async () => ({ projectId, namespace: 'cs-qa', slug: 'qa', name: 'qa' }) },
    sources: { configEnv: async () => ({ GREETING: 'keep' }), dataEnv: async () => ({ CS_DATABASE_URL: 'test-database' }), taskDataEnv: async () => ({}) },
    checkout: { checkoutFor: async () => { state.checkoutCalls++; return { repoUrl: 'https://git.invalid/qa.git', credentialSecretName: 'original-checkout' }; } },
    clock: { now: () => new Date(++time) }, settings: { taskImage: 'task:current', sessionUrl: 'ws://session/runner', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: 'coding-medium', userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' } });
  // 业务任务父环境（RFC-006 子任务执行环境）用持久卷模式，才能验证暂停。
  const initial = options.kind === 'business'
    ? await runtime.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent' })
    : await runtime.api.createEnvironment({ serviceId, kind: 'dev-session', branch: 'work', preview: { command: ['bun', 'run', 'dev'], port: 3000, healthPath: '/' } });
  const uow = drizzleUnitOfWork(tdb.db), env = (await uow.read.environments.getById(initial.id))!;
  const pod = (await k8s.get(Resources.Pod!, env.podName, env.namespace))!;
  const token = (pod.spec as { containers: Array<{ env: Array<{ name: string; value: string }> }> }).containers[0]!.env.find((v) => v.name === 'CS_RUNNER_TOKEN')!.value;
  await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { spec: { nodeName: 'worker-one' }, status: options.running ? { phase: 'Running' } : { phase: 'Failed', reason: 'OOMKilled' } });
  await k8s.mergePatch(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace, { status: { phase: 'Bound', capacity: { storage: '10Gi' } } });
  if (options.running) await runtime.api.onRunnerConnected(env.id, token);
  else await runtime.api.markFailed(env.id, 'OOMKilled');
  const request = async (): Promise<RebuildDevSessionRequest> => {
    const check = await runtime.api.inspectRebuild(projectId), profile = check.profiles[1]!;
    return { requestId: crypto.randomUUID(), expectedTaskId: env.id, expectedUpdatedAt: check.updatedAt, expectedPodUid: check.podUid, expectedVolumeUid: check.volume.uid,
      profile: { name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } };
  };
  const nextAttempt = async () => { await tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at = now() - interval '1 second'`); return (runtime.workers[0] as Worker).runOnce(); };
  return { tdb, k8s, runtime, state, env, token, uow, projectId, serviceId, request, nextAttempt,
    runNative: () => (runtime.workers[1] as Worker).runOnce(),
    nextNativeAttempt: async () => { await tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at = now() - interval '1 second'`); return (runtime.workers[1] as Worker).runOnce(); },
    advance: (ms: number) => { time += ms; }, run: () => (runtime.workers[0] as Worker).runOnce(), close: () => tdb.drop() };
}
