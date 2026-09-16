import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { AgentRuntimeMaterial, BeforeStartExecution, RunnerCommand, RunnerEvent, TaskId, UserId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import type { FakeK8sClient } from '@crewstation/k8s';
import { Resources, createFakeK8sClient } from '@crewstation/k8s';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { RUNTIME_CHECK_PROJECT_ID } from '../domain/runtimeCheckEnvironment';
import type { TaskRuntimeModule } from '../wiring';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let k8s: FakeK8sClient;
let runtime: TaskRuntimeModule;
const commands: RunnerCommand[] = [];
const events = new Map<string, Array<{ seq: number; at: string; event: RunnerEvent }>>();
const emit = (taskId: string, event: RunnerEvent) => { const list = events.get(taskId) ?? []; list.push({ seq: list.length + 1, at: new Date().toISOString(), event }); events.set(taskId, list); };
const capabilities: Record<string, unknown> = { drivers: ['opencode'], pty: true, preview: false, agentRuntimeConfig: 1, interpreters: [{ language: 'shell', command: '/bin/bash', version: '5.2' }] };
let onStart: ((taskId: string, command: Extract<RunnerCommand, { type: 'startAgent' }>) => void) | undefined;

const material: AgentRuntimeMaterial = { configId: 'arc_' + 'a'.repeat(32), configName: 'gw', revision: 2, driver: 'opencode', contentHash: 'h', steps: [{ kind: 'script', stepId: 'warm', name: '预热', language: 'shell', source: 'true', argv: [], timeoutMs: 2000 }], vars: {}, secrets: { KEY: 'sk-check' }, configFile: { kind: 'none' }, captureOutput: true };
const execution = (agentId: string, state: BeforeStartExecution['state'], stepState: 'succeeded' | 'failed'): BeforeStartExecution => ({ executionId: 'bse_1', agentId, processAttemptId: 'a:1', runtime: { configId: material.configId, revision: 2 }, state, queuedAt: new Date().toISOString(), steps: [{ stepId: 'warm', name: '预热', kind: 'script', state: stepState, exitCode: stepState === 'succeeded' ? 0 : 7, outputVariables: [], log: { stdoutTail: 'sk-check?', stderrTail: '' }, ...(stepState === 'failed' ? { error: { code: 'script_failed', message: '退出码 7', stepId: 'warm' } } : {}) }], ...(state === 'failed' ? { error: { code: 'script_failed', message: '退出码 7', stepId: 'warm' } } : {}) });

async function connectRunner(): Promise<TaskId> {
  const env = [...k8s.objects.values()].find((o) => o.kind === 'Pod' && o.metadata.namespace === 'crewstation-system')!;
  const taskId = env.metadata.labels!['crewstation.io/task'] as TaskId;
  const token = (env.spec as { containers: Array<{ env: Array<{ name: string; value: string }> }> }).containers[0]!.env.find((v) => v.name === 'CS_RUNNER_TOKEN')!.value;
  await k8s.mergePatch(Resources.Pod!, env.metadata.name, 'crewstation-system', { status: { phase: 'Running', containerStatuses: [{ name: 'task', imageID: 'registry/task@sha256:abc' }] } });
  expect(await runtime.api.onRunnerConnected(taskId, token)).toBe(true);
  return taskId;
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, queueMigrations, taskRuntimeMigrations]);
  k8s = createFakeK8sClient();
  runtime = createTaskRuntimeModule({
    db: tdb.db, k8s, authorizer: { authorize: async () => undefined }, quotas: { quotaLimit: async () => 2 },
    profiles: { listTaskProfiles: async () => [], getTaskProfile: async (name) => (name === 'coding-medium' ? { name, cpu: '1', memory: '2Gi', storage: '10Gi' } : undefined) },
    services: { resolveServiceById: async () => undefined },
    sources: { configEnv: async () => { throw new Error('检查任务不得读取项目配置'); }, dataEnv: async () => { throw new Error('检查任务不得读取项目数据'); }, taskDataEnv: async () => ({}) },
    isAdmin: async () => true,
    checkRunner: {
      sendCommand: async (taskId, command) => {
        commands.push(command);
        if (command.type === 'exec') return { execId: command.execId, exitCode: 0, stdout: 'opencode 1.18.29\n', stderr: '', durationMs: 3, truncated: false };
        if (command.type === 'startAgent') { onStart?.(taskId, command); return {}; }
        return {};
      },
      listEvents: async (taskId, options) => (events.get(taskId) ?? []).filter((e) => e.seq > (options?.sinceSeq ?? 0) && (!options?.kinds || options.kinds.includes(e.event.kind))),
      connectionStatus: async () => ({ connected: true, capabilities: capabilities as never }),
    },
    checkTiming: { pollMs: 20, connectTimeoutMs: 3000, modelBudgetMs: 2000 },
    settings: { taskImage: 'cs-task-runtime:test', systemNamespace: 'crewstation-system', sessionUrl: 'ws://cs-session:8083/runner', userDomain: 'cs.localhost', serviceDomain: 'svc.cs.internal', workerUid: 10001, defaultProfile: 'coding-medium', agentEnvSecretName: 'agent-env', userAuthMiddleware: 'forward-auth-user', dropIdentityHeadersMiddleware: 'drop-identity-headers' },
  });
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('运行环境检查执行器（RFC-004）', () => {
  test('完整 Hook 与真实回文：平台命名空间检查任务、镜像／CLI 版本、阶段表、结束后释放；旧凭据文件不挂载', async () => {
    const progress: unknown[] = [];
    let taskId: TaskId | undefined;
    onStart = (id, command) => {
      taskId = id as TaskId;
      expect(command).toMatchObject({ mode: 'oneshot', permission: 'read-only', runtime: { captureOutput: true, secrets: { KEY: 'sk-check' } }, processAttemptId: 'chk_1:1' });
      emit(id, { kind: 'beforeStart', execution: execution(command.agentId, 'running', 'succeeded') });
      emit(id, { kind: 'beforeStart', execution: execution(command.agentId, 'succeeded', 'succeeded') });
      emit(id, { kind: 'agent', event: { agentId: command.agentId, seq: 1, at: new Date().toISOString(), type: 'started' } });
      emit(id, { kind: 'agent', event: { agentId: command.agentId, seq: 2, at: new Date().toISOString(), type: 'text', text: 'Sure: CREWSTATION_RUNTIME_CHECK_X1' } });
      emit(id, { kind: 'agent', event: { agentId: command.agentId, seq: 3, at: new Date().toISOString(), type: 'completed' } });
    };
    const run = runtime.api.runRuntimeCheck({ checkId: 'chk_1', driver: 'opencode', model: 'anthropic/claude-x', material, prompt: 'say it', expectedReply: 'CREWSTATION_RUNTIME_CHECK_X1' }, async (p) => { progress.push(p); }, async () => true);
    // 等 Pod 创建后模拟 Runner 连接。
    await new Promise<void>((resolve) => { const timer = setInterval(() => { if ([...k8s.objects.values()].some((o) => o.kind === 'Pod' && o.metadata.namespace === 'crewstation-system')) { clearInterval(timer); resolve(); } }, 10); });
    await connectRunner();
    const outcome = await run;
    expect(outcome.state).toBe('succeeded');
    expect(outcome.context).toMatchObject({ taskId, image: 'cs-task-runtime:test', imageDigest: 'registry/task@sha256:abc', cliVersion: 'opencode 1.18.29', interpreters: [{ language: 'shell' }], workdir: '/work' });
    expect(outcome.stages.map((s) => [s.id, s.state])).toEqual([['step:warm', 'succeeded'], ['cli-config', 'succeeded'], ['model', 'succeeded']]);
    expect(outcome.stages.find((s) => s.id === 'step:warm')?.log?.stdoutTail).toBe('sk-check?');
    expect(outcome.stages.find((s) => s.id === 'model')?.detail).toContain('CREWSTATION_RUNTIME_CHECK_X1');
    const env = await runtime.api.getEnvironment(taskId!);
    expect(env).toMatchObject({ kind: 'runtime-check', state: 'released', projectId: RUNTIME_CHECK_PROJECT_ID, message: 'released: runtime-check' });
    expect(await runtime.api.runningTaskCount(RUNTIME_CHECK_PROJECT_ID)).toBe(0);
    const pod = k8s.deleted.find((d) => d.includes('/Pod/'));
    expect(pod).toBeDefined();
    const created = commands.find((c) => c.type === 'exec') as Extract<RunnerCommand, { type: 'exec' }>;
    expect(created.command).toEqual(['opencode', '--version']);
    expect(progress.length).toBeGreaterThan(1);
    // 检查任务只对管理员开放流；不读旧凭据文件。
    expect(await runtime.api.canOpenStream({ userId: 'usr_' + '1'.repeat(32) as UserId, isAdmin: false }, taskId!)).toBe(false);
    expect(await runtime.api.canOpenStream({ userId: 'usr_' + '1'.repeat(32) as UserId, isAdmin: true }, taskId!)).toBe(true);
  });

  test('Hook 失败：模型阶段不执行；回文缺少标记记为失败；Runner 失联记 unknown', async () => {
    onStart = (id, command) => {
      emit(id, { kind: 'beforeStart', execution: execution(command.agentId, 'failed', 'failed') });
      emit(id, { kind: 'agent', event: { agentId: command.agentId, seq: 1, at: new Date().toISOString(), type: 'error', error: { code: 'before_start_failed', message: '环境准备失败：步骤 warm，退出码 7' } } });
    };
    let run = runtime.api.runRuntimeCheck({ checkId: 'chk_2', driver: 'opencode', model: 'm', material, prompt: 'p', expectedReply: 'X' }, async () => undefined, async () => true);
    await waitForPod(); await connectRunner();
    let outcome = await run;
    expect(outcome).toMatchObject({ state: 'failed', error: '退出码 7' });
    expect(outcome.stages.map((s) => [s.id, s.state])).toEqual([['step:warm', 'failed'], ['cli-config', 'failed'], ['model', 'failed']]);

    onStart = (id, command) => {
      emit(id, { kind: 'agent', event: { agentId: command.agentId, seq: 1, at: new Date().toISOString(), type: 'started' } });
      emit(id, { kind: 'agent', event: { agentId: command.agentId, seq: 2, at: new Date().toISOString(), type: 'text', text: 'hello there' } });
      emit(id, { kind: 'agent', event: { agentId: command.agentId, seq: 3, at: new Date().toISOString(), type: 'completed' } });
    };
    run = runtime.api.runRuntimeCheck({ checkId: 'chk_3', driver: 'opencode', model: 'm', material, prompt: 'p', expectedReply: 'X' }, async () => undefined, async () => true);
    await waitForPod(); await connectRunner();
    outcome = await run;
    expect(outcome.state).toBe('failed');
    expect(outcome.stages.find((s) => s.id === 'model')).toMatchObject({ state: 'failed', detail: '回文摘录：hello there' });

    onStart = undefined;
    run = runtime.api.runRuntimeCheck({ checkId: 'chk_4', driver: 'opencode', model: 'm', material, prompt: 'p', expectedReply: 'X' }, async () => undefined, async () => true);
    await waitForPod();
    const taskId = await connectRunner();
    await Bun.sleep(60);
    await runtime.api.markFailed(taskId, '容器被驱逐');
    outcome = await run;
    expect(outcome.state).toBe('unknown');
    expect(outcome.error).toContain('容器被驱逐');
  });

  test('检查容器未连接超时 → 失败并释放；租约丢失 → unknown', async () => {
    let outcome = await runtime.api.runRuntimeCheck({ checkId: 'chk_5', driver: 'opencode', model: 'm', material, prompt: 'p', expectedReply: 'X' }, async () => undefined, async () => true);
    expect(outcome.state).toBe('failed');
    expect(outcome.error).toContain('未连接');
    outcome = await runtime.api.runRuntimeCheck({ checkId: 'chk_6', driver: 'opencode', model: 'm', material, prompt: 'p', expectedReply: 'X' }, async () => undefined, async () => false);
    expect(outcome).toMatchObject({ state: 'unknown' });
    expect(await runtime.api.runningTaskCount(RUNTIME_CHECK_PROJECT_ID)).toBe(0);
  });
});

async function waitForPod(): Promise<void> {
  await new Promise<void>((resolve) => { const timer = setInterval(() => { if ([...k8s.objects.values()].some((o) => o.kind === 'Pod' && o.metadata.namespace === 'crewstation-system')) { clearInterval(timer); resolve(); } }, 10); });
}
