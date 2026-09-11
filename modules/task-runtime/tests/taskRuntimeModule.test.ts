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
const serviceId = 'svc_0123456789abcdef0123456789abcdef' as ServiceId;
const projectId = 'prj_0123456789abcdef0123456789abcdef' as ProjectId;
let quota = 2;

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, taskRuntimeMigrations]);
  k8s = createFakeK8sClient();
  runtime = createTaskRuntimeModule({
    db: tdb.db, k8s,
    authorizer: { authorize: async () => undefined },
    quotas: { quotaLimit: async () => quota },
    profiles: { getTaskProfile: async (name) => (name === 'coding-medium' ? { name, cpu: '1', memory: '2Gi', storage: '10Gi' } : undefined) },
    services: { resolveServiceById: async () => ({ projectId, slug: 'demo', name: 'demo', namespace: 'cs-demo' }) },
    sources: { configEnv: async () => ({ GREETING: 'dev-hi' }), dataEnv: async () => ({ CS_DATABASE_URL: 'postgres://dev' }), taskDataEnv: async () => ({}) },
    checkout: { checkoutFor: async () => ({ repoUrl: 'http://git.local/crewstation/demo.git', credentialSecretName: 'git-checkout-demo' }) },
    isAdmin: async () => false,
    settings: { taskImage: 'cs-task-runtime:dev', systemNamespace: 'crewstation-system', sessionUrl: 'ws://cs-session:8083/runner', userDomain: 'cs.localhost', serviceDomain: 'svc.cs.internal', workerUid: 10001, defaultProfile: 'coding-medium', agentEnvSecretName: 'agent-env' },
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
    expect(k8s.objects.has(`v1/PersistentVolumeClaim/cs-demo/${dev.id.slice(4, 16) ? `task-${dev.id.slice(4, 16)}-work` : ''}`)).toBe(true);
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
    // 长驻容器的环境里没有 Git 令牌。
    expect(Object.keys(env).some((k) => k.includes('GIT_TOKEN'))).toBe(false);
    expect(env.CS_AGENT_ENV_FILE).toBe('/etc/crewstation/agent.env');
    expect(env.CS_RUNNER_TOKEN!.length).toBeGreaterThan(20);
    await expect(runtime.api.createEnvironment({ serviceId, kind: 'dev-session' })).rejects.toMatchObject({ kind: 'conflict' });

    expect(await runtime.api.verifyRunnerToken(dev.id, 'nope')).toMatchObject({ ok: false });
    expect(await runtime.api.verifyRunnerToken(dev.id, env.CS_RUNNER_TOKEN!)).toEqual({ ok: true, projectId });
    await runtime.api.onRunnerConnected(dev.id);
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

    await runtime.api.onRunnerConnected(biz.id);
    const paused = await runtime.api.pauseEnvironment(biz.id);
    expect(paused.state).toBe('paused');
    expect(k8s.objects.has(`v1/PersistentVolumeClaim/cs-demo/${biz.id.slice(4, 16) ? `task-${biz.id.slice(4, 16)}-work` : ''}`)).toBe(true);
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
});
