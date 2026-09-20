import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BeforeStartExecution, BeforeStartMaterial, ProbeTerminalResult, RunnerCommand, RunnerEvent, TaskId, UserId } from '@crewstation/contracts';
import { LaunchSpecSchema } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import type { FakeK8sClient, K8sObject } from '@crewstation/k8s';
import { Resources, createFakeK8sClient } from '@crewstation/k8s';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { ProfileTestRunInput, ProfileTestRunProgress } from '../api/moduleApi';
import { PROFILE_TEST_PROJECT_ID } from '../domain/profileTestEnvironment';
import type { TaskRuntimeModule } from '../wiring';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let k8s: FakeK8sClient;
let runtime: TaskRuntimeModule;
const commands: RunnerCommand[] = [];
const events = new Map<string, Array<{ seq: number; at: string; event: RunnerEvent }>>();
const emit = (taskId: string, event: RunnerEvent) => { const list = events.get(taskId) ?? []; list.push({ seq: list.length + 1, at: new Date().toISOString(), event }); events.set(taskId, list); };
const capabilities: Record<string, unknown> = { protocols: ['claude-code', 'opencode', 'terminal'], pty: true, preview: false, interpreters: [{ language: 'shell', command: '/bin/bash', version: '5.2' }] };
let onStart: ((taskId: string, command: Extract<RunnerCommand, { type: 'startAgent' }>) => void) | undefined;
let onProbe: ((taskId: string, command: Extract<RunnerCommand, { type: 'probeTerminal' }>) => Promise<ProbeTerminalResult>) | undefined;

const material: BeforeStartMaterial = { profile: '01a0bf5d-8f4b-73a2-878b-c4235f8d1a92', revision: 2, contentHash: 'h', steps: [{ kind: 'script', stepId: '01a0bf5d-8f4b-70f0-8aa4-08c1832abefd', name: '预热', language: 'shell', source: 'true', argv: [], timeoutMs: 2000 }], vars: {}, secrets: { KEY: 'sk-test' }, configFile: { kind: 'none' }, captureOutput: true };
const image = `registry.local:5000/runtime/gw@sha256:${'a'.repeat(64)}`;
const nonce = 'crewstation-test-5031c529ab';
const inputFor = (testId: string, patch: Partial<ProfileTestRunInput> = {}): ProfileTestRunInput => ({
  testId, profile: '01a0bf5d-8f4b-73a2-878b-c4235f8d1a92', revision: 2, launch: LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', model: 'anthropic/claude-x' }), image,
  beforeStart: material, prompt: `Output this exact token verbatim and nothing else: ${nonce}`, expectedReply: nonce, ...patch,
});
const execution = (agentId: string, state: BeforeStartExecution['state'], stepState: 'succeeded' | 'failed'): BeforeStartExecution => ({
  executionId: '01a0bf5d-8f4b-7e7f-81bb-b57bb9166e87', agentId, processAttemptId: 'a:1', profile: { profileId: '01a0bf5d-8f4b-73a2-878b-c4235f8d1a92', revision: 2 }, state, queuedAt: new Date().toISOString(),
  steps: [{ stepId: '01a0bf5d-8f4b-70f0-8aa4-08c1832abefd', name: '预热', kind: 'script', state: stepState, exitCode: stepState === 'succeeded' ? 0 : 7, log: { stdoutTail: 'warm ok', stderrTail: '' } }],
  ...(state === 'failed' ? { error: { code: 'script_failed' as const, message: '退出码 7', stepId: '01a0bf5d-8f4b-70f0-8aa4-08c1832abefd' } } : {}),
});
const agentEvent = (agentId: string, seq: number, patch: Partial<Extract<RunnerEvent, { kind: 'agent' }>['event']> & { type: Extract<RunnerEvent, { kind: 'agent' }>['event']['type'] }): RunnerEvent =>
  ({ kind: 'agent', event: { agentId, seq, at: new Date().toISOString(), ...patch } });

const testPods = (): K8sObject[] => [...k8s.objects.values()].filter((o) => o.kind === 'Pod' && o.metadata.namespace === 'crewstation-system');
async function waitForPod(): Promise<K8sObject> {
  for (;;) { const pod = testPods()[0]; if (pod) return pod; await Bun.sleep(10); }
}
async function podCredentials(): Promise<{ pod: K8sObject; taskId: TaskId; token: string }> {
  const pod = await waitForPod();
  const token = (pod.spec as { containers: Array<{ env: Array<{ name: string; value: string }> }> }).containers[0]!.env.find((v) => v.name === 'CS_RUNNER_TOKEN')!.value;
  return { pod, taskId: pod.metadata.labels!['crewstation.io/task'] as TaskId, token };
}
async function setPodStatus(status: Record<string, unknown>): Promise<void> {
  const pod = await waitForPod();
  await k8s.mergePatch(Resources.Pod!, pod.metadata.name, 'crewstation-system', { status });
}
async function connectRunner(): Promise<TaskId> {
  const { taskId, token } = await podCredentials();
  await setPodStatus({ phase: 'Running', containerStatuses: [{ name: 'task', imageID: image }] });
  expect(await runtime.api.onRunnerConnected(taskId, token)).toBe(true);
  return taskId;
}
async function settled(): Promise<void> {
  // 每个用例结束后测试 Pod 都已回收，下一个用例从空的系统命名空间开始。
  expect(testPods()).toHaveLength(0);
  expect(await runtime.api.runningTaskCount(PROFILE_TEST_PROJECT_ID)).toBe(0);
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, queueMigrations, taskRuntimeMigrations]);
  k8s = createFakeK8sClient();
  runtime = createTaskRuntimeModule({
    db: tdb.db, k8s, authorizer: { authorize: async () => undefined }, quotas: { quotaLimit: async () => 2 },
    profiles: { listTaskProfiles: async () => [], getTaskProfile: async (id) => (id === '01a0bf5d-8f4b-7001-8458-107366e7de39' || id === '01a0bf5d-8f4b-7dd6-8102-2aa5cc3255b1' ? { id, name: id === '01a0bf5d-8f4b-7001-8458-107366e7de39' ? 'coding-medium' : 'cli-small', cpu: id === '01a0bf5d-8f4b-7dd6-8102-2aa5cc3255b1' ? '500m' : '1', memory: '2Gi', storage: '10Gi' } : undefined) },
    services: { resolveServiceById: async () => undefined },
    sources: { configEnv: async () => { throw new Error('测试任务不得读取项目配置'); }, dataEnv: async () => { throw new Error('测试任务不得读取项目数据'); }, taskDataEnv: async () => ({}) },
    isAdmin: async () => true,
    testRunner: {
      sendCommand: async (taskId, command) => {
        commands.push(command);
        if (command.type === 'exec') return { execId: command.execId, exitCode: 0, stdout: 'opencode 1.18.29\n', stderr: '', durationMs: 3, truncated: false };
        if (command.type === 'startAgent') { onStart?.(taskId, command); return {}; }
        if (command.type === 'probeTerminal') return onProbe!(taskId, command);
        return {};
      },
      listEvents: async (taskId, options) => (events.get(taskId) ?? []).filter((e) => e.seq > (options?.sinceSeq ?? 0) && (!options?.kinds || options.kinds.includes(e.event.kind))),
      connectionStatus: async () => ({ connected: true, capabilities: capabilities as never }),
    },
    testTiming: { pollMs: 20, connectTimeoutMs: 1500, modelBudgetMs: 1500, disconnectGraceMs: 200 },
    testMcp: [{ name: 'capabilities', url: 'http://mcp-capabilities.svc.cs.internal/mcp' }, { name: 'operations', url: 'http://mcp-operations.svc.cs.internal/mcp' }],
    settings: { taskImage: 'cs-task-runtime:test', systemNamespace: 'crewstation-system', sessionUrl: 'ws://cs-session:8083/runner', userDomain: 'cs.localhost', serviceDomain: 'svc.cs.internal', workerUid: 10001, defaultProfile: '01a0bf5d-8f4b-7001-8458-107366e7de39', userAuthMiddleware: 'forward-auth-user', dropIdentityHeadersMiddleware: 'drop-identity-headers' },
  });
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('档位测试执行器（RFC-006 §6）', () => {
  test('已知协议通过：档位镜像与资源、显式 Runner 命令、临时工作目录、上下文与阶段、结束后释放', async () => {
    const progress: ProfileTestRunProgress[] = [];
    onStart = (id, command) => {
      emit(id, { kind: 'beforeStart', execution: execution(command.agentId, 'running', 'succeeded') });
      emit(id, { kind: 'beforeStart', execution: execution(command.agentId, 'succeeded', 'succeeded') });
      emit(id, agentEvent(command.agentId, 1, { type: 'started' }));
      emit(id, agentEvent(command.agentId, 2, { type: 'session', sessionId: 'ses-1' }));
      emit(id, agentEvent(command.agentId, 3, { type: 'text', text: `Sure: ${nonce}` }));
      emit(id, agentEvent(command.agentId, 4, { type: 'completed', result: { exitCode: 0 } }));
    };
    const run = runtime.api.runProfileTest(inputFor('01a0bf5d-8f4b-7435-8062-f84a0a1cba7b', { taskProfile: '01a0bf5d-8f4b-7dd6-8102-2aa5cc3255b1' }), async (p) => { progress.push(structuredClone(p)); }, async () => true);
    const { pod } = await podCredentials();
    const spec = pod.spec as { containers: Array<{ image: string; command: string[]; securityContext: { runAsUser: number }; resources: { limits: Record<string, string> } }>; volumes: Array<{ name: string; emptyDir?: unknown; persistentVolumeClaim?: unknown }> };
    expect(spec.containers[0]).toMatchObject({ image, command: ['/usr/bin/tini', '--', '/opt/crewstation/bin/task-runner'], securityContext: { runAsUser: 0 }, resources: { limits: { cpu: '500m' } } });
    expect(spec.volumes).toEqual([{ name: 'work', emptyDir: {} }]);
    expect(pod.metadata.labels).toMatchObject({ 'crewstation.io/project': 'platform', 'crewstation.io/service': 'profile-test', 'crewstation.io/workload': 'profile-test' });
    const taskId = await connectRunner();
    expect((await runtime.api.listClusterTasks()).find((task) => task.taskId === taskId)).toMatchObject({ profileTestId: '01a0bf5d-8f4b-7435-8062-f84a0a1cba7b' });
    const outcome = await run;
    expect(outcome).toMatchObject({ state: 'passed', outcome: 'passed' });
    expect(outcome.context).toMatchObject({ kind: 'platform-namespace', taskId, image, imageDigest: image, runnerProtocol: 3, cliVersion: 'opencode 1.18.29', interpreters: [{ language: 'shell' }], workdir: '/work' });
    expect(outcome.stages.map((s) => [s.id, s.state])).toEqual([['step:01a0bf5d-8f4b-70f0-8aa4-08c1832abefd', 'succeeded'], ['launch', 'succeeded'], ['model', 'succeeded']]);
    expect(progress.flatMap((p) => p.stages ?? []).filter((s) => s.id === 'runner').at(-1)).toMatchObject({ state: 'succeeded' });
    const start = commands.find((c) => c.type === 'startAgent') as Extract<RunnerCommand, { type: 'startAgent' }>;
    expect(start).toMatchObject({ compute: '01a0bf5d-8f4b-73a2-878b-c4235f8d1a92', profileRevision: 2, launch: { protocol: 'opencode', binaryPath: '/usr/local/bin/opencode' }, beforeStart: { captureOutput: true, secrets: { KEY: 'sk-test' } }, mode: 'oneshot', permission: 'full', processAttemptId: '01a0bf5d-8f4b-7435-8062-f84a0a1cba7b:1' });
    expect((commands.find((c) => c.type === 'exec') as Extract<RunnerCommand, { type: 'exec' }>).command).toEqual(['/usr/local/bin/opencode', '--version']);
    expect(await runtime.api.getEnvironment(taskId)).toMatchObject({ kind: 'profile-test', state: 'released', projectId: PROFILE_TEST_PROJECT_ID, message: 'released: profile-test' });
    // 测试任务的流只对管理员开放。
    expect(await runtime.api.canOpenStream({ userId: 'usr_' + '1'.repeat(32) as UserId, isAdmin: false }, taskId)).toBe(false);
    await settled();
  });

  test('启动前步骤失败 → before-start-failed；协议轮次到点仍无终态 → 取消并记 timeout', async () => {
    onStart = (id, command) => {
      emit(id, { kind: 'beforeStart', execution: execution(command.agentId, 'failed', 'failed') });
      emit(id, agentEvent(command.agentId, 1, { type: 'error', error: { code: 'before_start_failed', message: '环境准备失败：步骤 warm，退出码 7' } }));
    };
    let run = runtime.api.runProfileTest(inputFor('01a0bf5d-8f4b-71a4-87c3-ed4170af7722'), async () => undefined, async () => true);
    await connectRunner();
    let outcome = await run;
    expect(outcome).toMatchObject({ state: 'failed', outcome: 'before-start-failed', error: '退出码 7' });
    expect(outcome.stages.map((s) => [s.id, s.state])).toEqual([['step:01a0bf5d-8f4b-70f0-8aa4-08c1832abefd', 'failed'], ['launch', 'skipped'], ['model', 'skipped']]);
    await settled();

    onStart = (id, command) => { emit(id, agentEvent(command.agentId, 1, { type: 'started' })); };
    run = runtime.api.runProfileTest(inputFor('01a0bf5d-8f4b-760f-8353-d4029283b2da', { beforeStart: { ...material, steps: [] } }), async () => undefined, async () => true);
    await connectRunner();
    outcome = await run;
    expect(outcome).toMatchObject({ state: 'failed', outcome: 'timeout' });
    expect(commands.some((c) => c.type === 'cancelAgent')).toBe(true);
    await settled();
  });

  test('镜像拉取失败、容器起不来（不是平台底座）、Runner 协议不一致各自归类，且都回收测试任务', async () => {
    let run = runtime.api.runProfileTest(inputFor('01a0bf5d-8f4b-7070-81f4-37cf89ab858a'), async () => undefined, async () => true);
    await setPodStatus({ phase: 'Pending', containerStatuses: [{ name: 'task', state: { waiting: { reason: 'ImagePullBackOff' } } }] });
    let outcome = await run;
    expect(outcome).toMatchObject({ state: 'failed', outcome: 'image-pull-failed' });
    expect(outcome.stages.find((s) => s.id === 'image')).toMatchObject({ state: 'failed' });
    await settled();

    run = runtime.api.runProfileTest(inputFor('01a0bf5d-8f4b-79c1-8d79-72343746d411'), async () => undefined, async () => true);
    await setPodStatus({ phase: 'Failed', containerStatuses: [{ name: 'task', imageID: image, state: { terminated: { reason: 'StartError', exitCode: 128 } } }] });
    outcome = await run;
    expect(outcome).toMatchObject({ state: 'failed', outcome: 'runner-unavailable' });
    expect(outcome.error).toContain('/opt/crewstation/bin/task-runner');
    await settled();

    run = runtime.api.runProfileTest(inputFor('01a0bf5d-8f4b-7320-89ce-e4c8c555025e'), async () => undefined, async () => true);
    const { taskId, token } = await podCredentials();
    await runtime.api.onRunnerRejected(taskId, 'wrong-token', { code: 'protocol_mismatch', runnerProtocol: 1, message: '伪造的拒绝' });
    await runtime.api.onRunnerRejected(taskId, token, { code: 'protocol_mismatch', runnerProtocol: 1, message: 'Runner 协议版本 1，平台要求 2；请基于当前平台底座镜像重建镜像' });
    outcome = await run;
    expect(outcome).toMatchObject({ state: 'failed', outcome: 'runner-protocol-mismatch', error: 'Runner 协议版本 1，平台要求 2；请基于当前平台底座镜像重建镜像' });
    await settled();
  });

  test('通用终端：probeTerminal 通过与输出不匹配；租约丢失与环境中途失败记 unknown', async () => {
    const terminal = LaunchSpecSchema.parse({ protocol: 'terminal', binaryPath: '/opt/tool/bin/tool' });
    const terminalTest = { command: ['/opt/tool/bin/tool', '--version'], expect: 'tool \\d', timeoutMs: 5000 };
    onProbe = async (id, command) => {
      emit(id, { kind: 'beforeStart', execution: execution(command.probeId, 'succeeded', 'succeeded') });
      return { probeId: command.probeId, beforeStart: { state: 'succeeded' }, command: { exitCode: 0, timedOut: false, matched: command.command.length === 2, outputTail: 'tool 1.2.3', durationMs: 8 } };
    };
    let run = runtime.api.runProfileTest(inputFor('01a0bf5d-8f4b-7240-850d-329eaa9550d5', { launch: terminal, terminalTest }), async () => undefined, async () => true);
    await connectRunner();
    let outcome = await run;
    expect(outcome).toMatchObject({ state: 'passed', outcome: 'passed', context: { cliVersion: null } });
    expect(outcome.stages.map((s) => [s.id, s.state])).toEqual([['step:01a0bf5d-8f4b-70f0-8aa4-08c1832abefd', 'succeeded'], ['command', 'succeeded']]);
    expect(commands.filter((c) => c.type === 'probeTerminal').at(-1)).toMatchObject({ command: terminalTest.command, expect: 'tool \\d', timeoutMs: 5000, processAttemptId: '01a0bf5d-8f4b-7240-850d-329eaa9550d5:1', mcp: [] });
    await settled();

    // 步骤内容引用了 {{mcp.*}}：测试给平台 MCP 的真实地址与不授权的占位令牌，模板才展开得了（2026-09-18 实机：没给时步骤报「未定义」）。
    const mcpStep = { kind: 'file' as const, stepId: 'mcp-hint', name: '写 MCP 地址', pathTemplate: '{{agent.home}}/mcp.txt', contentTemplate: 'caps={{mcp.capabilitiesUrl}}', format: 'text' as const, mode: 0o600, existing: 'require-same' as const };
    // 同时复现实机的顺序：执行器轮询时只看到「执行中」，步骤成功事件紧挨着回执到达——阶段仍要以终态收尾。
    const matchingProbe = onProbe;
    onProbe = async (id, command) => {
      const running = execution(command.probeId, 'running', 'succeeded');
      emit(id, { kind: 'beforeStart', execution: { ...running, steps: running.steps.map((step) => ({ ...step, state: 'running' as const })) } });
      await Bun.sleep(80);
      emit(id, { kind: 'beforeStart', execution: execution(command.probeId, 'succeeded', 'succeeded') });
      return { probeId: command.probeId, beforeStart: { state: 'succeeded' }, command: { exitCode: 0, timedOut: false, matched: true, outputTail: 'tool 1.2.3', durationMs: 3 } };
    };
    run = runtime.api.runProfileTest(inputFor('01a0bf5d-8f4b-7fe8-864d-0601648ca176', { launch: terminal, terminalTest, beforeStart: { ...material, steps: [mcpStep] } }), async () => undefined, async () => true);
    await connectRunner();
    const passedWithMcp = await run;
    expect(passedWithMcp.state).toBe('passed');
    expect(passedWithMcp.stages.map((st) => [st.id, st.state])).toEqual([['step:01a0bf5d-8f4b-70f0-8aa4-08c1832abefd', 'succeeded'], ['command', 'succeeded']]);
    expect(commands.filter((c) => c.type === 'probeTerminal').at(-1)).toMatchObject({ processAttemptId: '01a0bf5d-8f4b-7fe8-864d-0601648ca176:1', mcp: [
      { name: 'capabilities', url: 'http://mcp-capabilities.svc.cs.internal/mcp', headers: { 'x-cs-dev-session-token': 'crewstation-profile-test-no-mcp-access' } },
      { name: 'operations', url: 'http://mcp-operations.svc.cs.internal/mcp', headers: { 'x-cs-dev-session-token': 'crewstation-profile-test-no-mcp-access' } },
    ] });
    await settled();
    onProbe = matchingProbe;

    run = runtime.api.runProfileTest(inputFor('01a0bf5d-8f4b-7f69-84c6-8ac9202fde86', { launch: terminal, terminalTest: { ...terminalTest, command: ['/opt/tool/bin/tool'] } }), async () => undefined, async () => true);
    await connectRunner();
    outcome = await run;
    expect(outcome).toMatchObject({ state: 'failed', outcome: 'output-mismatch' });
    await settled();

    outcome = await runtime.api.runProfileTest(inputFor('01a0bf5d-8f4b-77e8-89f8-d28eda48152f'), async () => undefined, async () => false);
    expect(outcome).toMatchObject({ state: 'unknown', outcome: 'environment-lost' });
    await settled();

    onStart = undefined;
    run = runtime.api.runProfileTest(inputFor('01a0bf5d-8f4b-7d6a-8997-331266dcd7b1'), async () => undefined, async () => true);
    const taskId = await connectRunner();
    await Bun.sleep(60);
    await runtime.api.markFailed(taskId, '容器被驱逐');
    outcome = await run;
    expect(outcome).toMatchObject({ state: 'unknown', outcome: 'environment-lost' });
    expect(outcome.error).toContain('容器被驱逐');
    await settled();
  });
});
