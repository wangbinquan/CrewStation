import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import type { FakeK8sClient } from '@crewstation/k8s';
import { Resources, createFakeK8sClient } from '@crewstation/k8s';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TaskRuntimeModule } from '../wiring';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let k8s: FakeK8sClient;
let runtime: TaskRuntimeModule;
const serviceId = '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId;
const projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192' as ProjectId;
let quota = 2;

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, taskRuntimeMigrations]);
  k8s = createFakeK8sClient();
  runtime = createTaskRuntimeModule({
    db: tdb.db, k8s,
    authorizer: { authorize: async () => undefined },
    quotas: { quotaLimit: async () => quota },
    profiles: { listTaskProfiles: async () => [{ id: '01a0bf5d-8f4b-7001-8458-107366e7de39', name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi', description: '' }], getTaskProfile: async (id) => (id === '01a0bf5d-8f4b-7001-8458-107366e7de39' ? { id, name: id === '01a0bf5d-8f4b-7001-8458-107366e7de39' ? 'coding-medium' : 'cli-small', cpu: '1', memory: '2Gi', storage: '10Gi' } : undefined) },
    services: { resolveServiceById: async () => ({ projectId, slug: 'demo', name: 'demo', namespace: 'cs-demo' }) },
    sources: { configEnv: async () => ({ GREETING: 'dev-hi' }), dataEnv: async () => ({ CS_DATABASE_URL: 'postgres://dev' }), taskDataEnv: async () => ({}) },
    checkout: { checkoutFor: async () => ({ repoUrl: 'http://git.local/crewstation/demo.git', credentialSecretName: 'git-checkout-demo' }) },
    isAdmin: async () => false,
    settings: { taskImage: 'cs-task-runtime:dev', systemNamespace: 'crewstation-system', sessionUrl: 'ws://cs-session:8083/runner', userDomain: 'cs.localhost', serviceDomain: 'svc.cs.internal', workerUid: 10001, defaultProfile: '01a0bf5d-8f4b-7001-8458-107366e7de39', userAuthMiddleware: 'forward-auth-user', dropIdentityHeadersMiddleware: 'drop-identity-headers' },
  });
});
afterAll(async () => { await tdb?.drop(); });

const podEnv = (podName: string): Record<string, string> => {
  const pod = k8s.objects.get(`v1/Pod/cs-demo/${podName}`)!;
  const env = (pod.spec as { containers: Array<{ env: Array<{ name: string; value: string }> }> }).containers[0]!.env;
  return Object.fromEntries(env.map((e) => [e.name, e.value]));
};

describe.skipIf(!available)('task-runtime module', () => {
  test('开发会话：建卷建 Pod、环境变量、一项目一会话、配额原子准入、令牌校验、释放回收', async () => {
    const dev = await runtime.api.createEnvironment({ serviceId, kind: 'dev-session', branch: 'main', preview: { command: ['bun', 'run', '--watch', 'src/main.ts'], port: 3000, healthPath: '/healthz' } });
    expect(dev.state).toBe('creating');
    expect(k8s.objects.has(`v1/PersistentVolumeClaim/cs-demo/task-${dev.id.replaceAll('-', '')}-work`)).toBe(true);
    const env = podEnv(dev.podName);
    expect(env.CS_ENVIRONMENT).toBe('development');
    expect(env.GREETING).toBe('dev-hi');
    expect(env.CS_PREVIEW_PORT).toBe('3000');

    // 开发会话必须把源码克隆进工作卷，否则容器里是空目录。
    const devPod = k8s.objects.get(`v1/Pod/cs-demo/${dev.podName}`)!;
    const init = (devPod.spec as { initContainers?: Array<{ name: string; env: Array<{ name: string; value?: string; valueFrom?: unknown }>; volumeMounts: Array<{ mountPath: string }> }> }).initContainers ?? [];
    expect(init.map((c) => c.name)).toEqual(['checkout']);
    const initEnv = Object.fromEntries(init[0]!.env.map((e) => [e.name, e.value]));
    expect(initEnv.CS_REPO_URL).toBe('http://git.local/crewstation/demo.git');
    expect(initEnv.CS_BRANCH).toBe('main');
    // 令牌只以 secretKeyRef 出现，不作为明文值。
    expect(initEnv.CS_GIT_TOKEN).toBeUndefined();
    expect(init[0]!.volumeMounts.some((m) => m.mountPath === '/work')).toBe(true);

    // 开发预览的路由随 Pod 建：目标 Service 是按任务建的，放进 gateway 的按服务重算里对不上生命周期。
    const route = k8s.objects.get(`traefik.io/v1alpha1/IngressRoute/cs-demo/${dev.podName}`)!;
    const rule = (route.spec as { routes: Array<{ match: string; services: Array<{ name: string }>; middlewares: Array<{ name: string; namespace: string }> }> }).routes[0]!;
    expect(rule.match).toBe('Host(`dev.demo.cs.localhost`)');
    expect(rule.services[0]!.name).toBe(dev.podName);
    expect(rule.middlewares.map((m) => `${m.namespace}/${m.name}`)).toEqual(['crewstation-system/drop-identity-headers', 'crewstation-system/forward-auth-user']);
    // 长驻容器的环境里没有 Git 令牌。
    expect(Object.keys(env).some((k) => k.includes('GIT_TOKEN'))).toBe(false);
    // RFC-006 §7.3：显式的 Runner 启动路径与 root 身份；不再挂旧的 agent-env 凭据文件，也没有它的环境变量。
    const main = devPod.spec as { containers: Array<{ command?: string[]; securityContext?: { runAsUser?: number } }>; volumes: Array<{ name: string }> };
    expect(main.containers[0]).toMatchObject({ command: ['/usr/bin/tini', '--', '/opt/crewstation/bin/task-runner'], securityContext: { runAsUser: 0 } });
    expect(main.volumes.map((v) => v.name)).toEqual(['work']);
    expect(env.CS_AGENT_ENV_FILE).toBeUndefined();
    expect(env.CS_RUNNER_TOKEN!.length).toBeGreaterThan(20);
    await expect(runtime.api.createEnvironment({ serviceId, kind: 'dev-session' })).rejects.toMatchObject({ kind: 'conflict' });

    expect(await runtime.api.verifyRunnerToken(dev.id, 'nope')).toMatchObject({ ok: false });
    expect(await runtime.api.verifyRunnerToken(dev.id, env.CS_RUNNER_TOKEN!)).toEqual({ ok: true, projectId });
    await runtime.api.onRunnerConnected(dev.id, env.CS_RUNNER_TOKEN!);
    expect(await runtime.api.getEnvironment(dev.id)).toMatchObject({ state: 'running', connected: true });

    const biz = await runtime.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent' });
    expect(podEnv(biz.podName).CS_ENVIRONMENT).toBe('production');
    await expect(runtime.api.createEnvironment({ serviceId, kind: 'business' })).rejects.toMatchObject({ kind: 'quota_exceeded' });

    const released = await runtime.api.releaseEnvironment(dev.id, 'user');
    expect(released.state).toBe('released');
    expect(k8s.deleted.some((k) => k.includes(dev.podName))).toBe(true);
    expect(k8s.deleted.some((k) => k.includes('-work'))).toBe(true);
    expect((await runtime.api.createEnvironment({ serviceId, kind: 'business' })).state).toBe('creating');
    expect(await runtime.api.verifyRunnerToken(dev.id, env.CS_RUNNER_TOKEN!)).toMatchObject({ ok: false });

    await runtime.api.onRunnerConnected(biz.id, podEnv(biz.podName).CS_RUNNER_TOKEN!);
    const paused = await runtime.api.pauseEnvironment(biz.id);
    expect(paused.state).toBe('paused');
    expect(k8s.objects.has(`v1/PersistentVolumeClaim/cs-demo/task-${biz.id.replaceAll('-', '')}-work`)).toBe(true);
    const resumed = await runtime.api.resumeEnvironment(biz.id);
    expect(resumed.state).toBe('creating');
    expect(podEnv(biz.podName).CS_RUNNER_TOKEN).not.toBe(podEnv(dev.podName === biz.podName ? '' : biz.podName).CS_RUNNER_TOKEN === undefined);
  });

  test('对账：Pod 消失即标 failed 并释放配额', async () => {
    quota = 5;
    const env = await runtime.api.createEnvironment({ serviceId, kind: 'business' });
    await k8s.delete(Resources.Pod!, env.podName, 'cs-demo');
    expect(await runtime.api.reconcile()).toBeGreaterThanOrEqual(1);
    expect(await runtime.api.getEnvironment(env.id)).toMatchObject({ state: 'failed' });
    const rows = (await tdb.db.execute(`SELECT running FROM task_runtime.admissions`)) as unknown as Array<{ running: number }>;
    expect(rows[0]!.running).toBeLessThanOrEqual(2);
  });

  test('业务恢复等待旧 Pod 真正删除再占用配额，保留工作卷且仅创建一次新实例', async () => {
    quota = 20;
    const env = await runtime.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent' });
    const key = `v1/Pod/cs-demo/${env.podName}`, oldPod = k8s.objects.get(key)!;
    const volume = k8s.objects.get(`v1/PersistentVolumeClaim/cs-demo/${env.podName}-work`)!;
    await runtime.api.onRunnerConnected(env.id, podEnv(env.podName).CS_RUNNER_TOKEN!);
    await runtime.api.pauseEnvironment(env.id);
    const before = await runtime.api.runningTaskCount(projectId);
    k8s.objects.set(key, { ...oldPod, metadata: { ...oldPod.metadata, deletionTimestamp: new Date().toISOString() } });
    const originalGet = k8s.get, originalCreate = k8s.create; let reads = 0, created = 0;
    k8s.create = async (object) => {
      if (object.kind === 'Pod' && object.metadata.name === env.podName) {
        created += 1;
        return originalCreate({ ...object, metadata: { ...object.metadata, uid: crypto.randomUUID() } });
      }
      return originalCreate(object);
    };
    k8s.get = async (ref, name, namespace) => {
      if (ref.kind === 'Pod' && name === env.podName && namespace === 'cs-demo') {
        expect((await runtime.api.getEnvironment(env.id))?.state).toBe('paused');
        expect(await runtime.api.runningTaskCount(projectId)).toEqual(before);
        if (++reads === 3) k8s.objects.delete(key);
      }
      return originalGet(ref, name, namespace);
    };
    try {
      const resumed = await runtime.api.resumeEnvironment(env.id);
      expect(reads).toBe(3); expect(created).toBe(1); expect(resumed.state).toBe('creating');
      expect(k8s.objects.get(key)?.metadata.uid).not.toBe(oldPod.metadata.uid);
      expect(k8s.objects.get(`v1/PersistentVolumeClaim/cs-demo/${env.podName}-work`)?.metadata.uid).toBe(volume.metadata.uid);
    } finally { k8s.get = originalGet; k8s.create = originalCreate; await runtime.api.releaseEnvironment(env.id, 'business'); }
  });

  test('业务恢复遇到同名不同 UID 时保留暂停状态与配额，拒绝覆盖新实例', async () => {
    quota = 20;
    const env = await runtime.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent' });
    const key = `v1/Pod/cs-demo/${env.podName}`, oldPod = k8s.objects.get(key)!;
    await runtime.api.onRunnerConnected(env.id, podEnv(env.podName).CS_RUNNER_TOKEN!);
    await runtime.api.pauseEnvironment(env.id);
    const before = await runtime.api.runningTaskCount(projectId);
    k8s.objects.set(key, { ...oldPod, metadata: { ...oldPod.metadata, uid: 'replacement-instance' } });
    try {
      await expect(runtime.api.resumeEnvironment(env.id)).rejects.toThrow('实例已变化');
      expect(await runtime.api.getEnvironment(env.id)).toMatchObject({ state: 'paused' });
      expect((await runtime.api.listClusterTasks()).find((task) => task.taskId === env.id)?.podUid).toBe(oldPod.metadata.uid);
      expect(await runtime.api.runningTaskCount(projectId)).toEqual(before);
      expect(k8s.objects.get(key)?.metadata.uid).toBe('replacement-instance');
    } finally { k8s.objects.delete(key); await runtime.api.releaseEnvironment(env.id, 'business'); }
  });

  test('只读会话查询保留最新失败，显式新建与释放后不复活旧失败记录', async () => {
    quota = 5;
    const failed = await runtime.api.createEnvironment({ serviceId, kind: 'dev-session', branch: 'main' });
    const pod = k8s.objects.get(`v1/Pod/cs-demo/${failed.podName}`)!;
    await k8s.apply({ ...pod, status: { phase: 'Failed', containerStatuses: [{ name: failed.podName, state: { terminated: { reason: 'OOMKilled', exitCode: 137 } } }] } } as typeof pod);
    await runtime.api.reconcile();
    // 实机 OOM 后 active-only 查询变成 404，失败原因、个人布局和未推送工作一起从开发页消失。
    const visible = await runtime.api.findDevSession(projectId, { includeLatestFailure: true });
    expect(visible).toMatchObject({ id: failed.id, state: 'failed', connected: false });
    expect(visible?.message).toContain('OOMKilled');
    expect(await runtime.api.findDevSession(projectId)).toBeUndefined();
    const oldVolume = `v1/PersistentVolumeClaim/cs-demo/task-${failed.id.replaceAll('-', '')}-work`;
    expect(k8s.objects.has(oldVolume)).toBe(true);
    const replacement = await runtime.api.createEnvironment({ serviceId, kind: 'dev-session', branch: 'main' });
    expect(replacement.id).not.toBe(failed.id);
    expect(await runtime.api.findDevSession(projectId, { includeLatestFailure: true })).toMatchObject({ id: replacement.id });
    await runtime.api.releaseEnvironment(replacement.id, 'user');
    expect(await runtime.api.findDevSession(projectId, { includeLatestFailure: true })).toBeUndefined();
    expect(k8s.objects.has(oldVolume)).toBe(true);
    expect(await runtime.api.getEnvironment(failed.id)).toMatchObject({ state: 'failed' });
  });
});
