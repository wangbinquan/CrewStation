import type { ProjectId, RebuildDevSessionRequest, ServiceId, TaskProfileDto } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { queueMigrations } from '@crewstation/queue';
import type { Worker } from '@crewstation/queue';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';

export async function rebuildFixture(options: { running?: boolean; kind?: 'dev-session' | 'business'; assignedProfile?: string } = {}) {
  const tdb = await createTestDatabase([eventbusMigrations, queueMigrations, taskRuntimeMigrations]);
  const k8s = createFakeK8sClient();
  const projectId = '01a0bf5d-8f4b-7fc7-8b88-18362617594b' as ProjectId, serviceId = '01a0bf5d-8f4b-77df-8856-e078a980dc2f' as ServiceId;
  let time = Date.parse('2026-09-15T10:00:00Z');
  const state = { assignedProfile: options.assignedProfile, quota: 2, checkoutCalls: 0, profiles: [{ id: '01a0bf5d-8f4b-7001-8458-107366e7de39', name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi', description: '' },
    { id: '01a0bf5d-8f4b-7f2b-8caf-3349046050a1', name: 'coding-large', cpu: '2', memory: '4Gi', storage: '20Gi', description: '' }] as TaskProfileDto[] };
  const runtime = createTaskRuntimeModule({ db: tdb.db, k8s, authorizer: { authorize: async () => {} }, isAdmin: async () => true,
    quotas: { quotaLimit: async () => state.quota }, profiles: { devSessionProfile: async () => state.assignedProfile, listTaskProfiles: async () => state.profiles, getTaskProfile: async (name) => state.profiles.find((p) => p.id === name) },
    services: { resolveServiceById: async () => ({ projectId, namespace: 'cs-qa', slug: 'qa', name: 'qa' }) },
    sources: { configEnv: async () => ({ GREETING: 'keep' }), dataEnv: async () => ({ CS_DATABASE_URL: 'test-database' }), taskDataEnv: async () => ({}) },
    checkout: { checkoutFor: async () => { state.checkoutCalls++; return { repoUrl: 'https://git.invalid/qa.git', credentialSecretName: 'original-checkout' }; } },
    clock: { now: () => new Date(++time) }, settings: { taskImage: 'task:current', sessionUrl: 'ws://session/runner', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: '01a0bf5d-8f4b-7001-8458-107366e7de39', userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' } });
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
    const check = await runtime.api.inspectRebuild(projectId), profile = check.profiles.at(-1)!;
    return { requestId: crypto.randomUUID(), expectedTaskId: env.id, expectedUpdatedAt: check.updatedAt, expectedPodUid: check.podUid, expectedVolumeUid: check.volume.uid,
      profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } };
  };
  const nextAttempt = async () => { await tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at = now() - interval '1 second'`); return (runtime.workers[0] as Worker).runOnce(); };
  return { tdb, k8s, runtime, state, env, token, uow, projectId, serviceId, request, nextAttempt,
    runNative: () => (runtime.workers[1] as Worker).runOnce(),
    nextNativeAttempt: async () => { await tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at = now() - interval '1 second'`); return (runtime.workers[1] as Worker).runOnce(); },
    advance: (ms: number) => { time += ms; }, run: () => (runtime.workers[0] as Worker).runOnce(), close: () => tdb.drop() };
}
