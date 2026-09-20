import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProfileRevisionRef, ProjectId, ReleaseId, RunnerCommand, RunnerEvent, ServiceActor, ServiceId, TaskId } from '@crewstation/contracts';
import { LaunchSpecSchema } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { forbidden, precondition, quotaExceeded, validation } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { ComputeCatalog, EnvironmentView } from '../ports/runtime';
import type { BusinessTaskModule } from '../wiring';
import { businessTaskMigrations, createBusinessTaskModule } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let bt: BusinessTaskModule;
const serviceId = 'svc_0123456789abcdef0123456789abcdef' as ServiceId;
const projectId = 'prj_0123456789abcdef0123456789abcdef' as ProjectId;
const caller: ServiceActor = { identity: 'demo/demo', project: 'demo', service: 'demo', slot: 'prod' };
const stranger: ServiceActor = { identity: 'other/other', project: 'other', service: 'other' };
const commands: RunnerCommand[] = [];
/** 命令发往哪个 Runner：RFC-006 起 Agent 子任务的命令发往它自己的执行环境。 */
const routed: Array<{ taskId: string; command: RunnerCommand }> = [];
/** Agent 子任务的执行环境（每个 Agent 一个 Pod）；connected 模拟子 Runner 是否已连上。 */
const executions = new Map<string, EnvironmentView>();
const executionControls = { connected: true, reject: undefined as unknown };
const events = new Map<string, Array<{ seq: number; at: string; event: RunnerEvent }>>();
const released: string[] = [];
/** 某条命令发往的 Runner 任务 ID（Agent 子任务的是它的执行环境）。 */
const runnerOf = (command: RunnerCommand): string => routed.find((r) => r.command === command)!.taskId;
const emit = (taskId: string, event: RunnerEvent) => { const list = events.get(taskId) ?? []; list.push({ seq: list.length + 1, at: new Date().toISOString(), event }); events.set(taskId, list); };
const agentEvent = (agentId: string, type: string, extra: Record<string, unknown> = {}): RunnerEvent => ({ kind: 'agent', event: { agentId, seq: 0, at: new Date().toISOString(), type, ...extra } as never });

let runnerConnected = true;
/** 可变：验证「登记时存在、起子任务时被管理员删掉」的档位（RFC-001），以及修订与默认档位随时间变化（RFC-006）。 */
let computeProfiles: Array<{ name: string; revision: number; isDefault?: boolean }> = [{ name: 'sample-opencode', revision: 1, isDefault: true }];
const materialRequests: ProfileRevisionRef[] = [];
const image = `registry.test/runtime/sample@sha256:${'0'.repeat(64)}`;
let denyCompute = false;
const computeProjects: ProjectId[] = [];
const fakeCompute: ComputeCatalog = {
  resolve: async (name, _usage, id) => {
    computeProjects.push(id);
    if (denyCompute) throw forbidden('项目未获授权使用此档位');
    const found = !name || name === 'default' ? computeProfiles.find((p) => p.isDefault) : computeProfiles.find((p) => p.name === name);
    if (!found && (!name || name === 'default')) throw precondition('平台尚未设置默认算力档位，请管理员在平台管理里设置', { code: 'no_default_profile' });
    if (!found) throw validation(`算力档位 ${name} 不存在`, { code: 'profile_not_found', available: computeProfiles.map((p) => p.name) });
    return { name: found.name, revision: found.revision, protocol: 'opencode', image };
  },
  launchMaterial: async (ref) => {
    materialRequests.push(ref);
    return { name: ref.profile, revision: ref.revision, protocol: 'opencode', image, launch: LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', model: 'opencode/one' }),
      beforeStart: { profile: ref.profile, revision: ref.revision, contentHash: 'h', steps: [], vars: {}, secrets: { KEY: 'sk-business' }, configFile: { kind: 'none' }, captureOutput: false } };
  },
};

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, businessTaskMigrations]);
  bt = createBusinessTaskModule({
    db: tdb.db,
    environments: {
      createEnvironment: async (input) => ({ id: `tsk_${Bun.randomUUIDv7().replace(/-/g, '')}` as TaskId, projectId, state: 'running', connected: true, traceId: input.traceId ?? '0123456789abcdef0123456789abcdef', podName: 'task-1' }),
      createNativeExecution: async (input) => {
        const existing = executions.get(input.id); if (existing) return existing;
        if (executionControls.reject) throw executionControls.reject;
        const env: EnvironmentView = { id: input.id, projectId, state: executionControls.connected ? 'running' : 'creating', connected: executionControls.connected, traceId: 't', podName: `sub-${input.id.slice(4)}`, native: { state: executionControls.connected ? 'running' : 'queued' } };
        executions.set(input.id, env);
        return env;
      },
      releaseEnvironment: async (taskId) => {
        released.push(taskId);
        const execution = executions.get(taskId);
        if (execution) { execution.connected = false; execution.state = 'releasing'; execution.native = { ...execution.native!, state: 'cleaning' }; return execution; }
        return { id: taskId, projectId, state: 'released', connected: false, traceId: 't', podName: 'task-1' };
      },
      pauseEnvironment: async (taskId) => ({ id: taskId, projectId, state: 'paused', connected: false, traceId: 't', podName: 'task-1' }),
      resumeEnvironment: async (taskId) => ({ id: taskId, projectId, state: 'creating', connected: false, traceId: 't', podName: 'task-1' }),
      getEnvironment: async (taskId) => executions.get(taskId) ?? ({ id: taskId, projectId, state: runnerConnected ? 'running' : 'creating', connected: runnerConnected, traceId: 't', podName: 'task-1' }),
    },
    runner: {
      sendCommand: async (taskId, command) => {
        commands.push(command);
        routed.push({ taskId, command });
        if (command.type === 'exec') { emit(taskId, { kind: 'execExited', execId: command.execId, exitCode: command.command.includes('fail') ? 2 : 0, durationMs: 5 }); return { execId: command.execId, exitCode: command.command.includes('fail') ? 2 : 0, stdout: 'done\n', stderr: '', durationMs: 5, truncated: false }; }
        if (command.type === 'verifyContract') return { ok: !command.contract.required.includes('missing.md'), missing: command.contract.required.filter((f) => f === 'missing.md'), schemaErrors: [] };
        return {};
      },
      listEvents: async (taskId, options) => (events.get(taskId) ?? []).filter((e) => (!options?.kinds || options.kinds.includes(e.event.kind)) && (!options?.agentId || (e.event.kind === 'agent' && e.event.event.agentId === options.agentId))),
    },
    directory: { resolveServiceIdentity: async (identity) => (identity === 'demo/demo' ? { serviceId, projectId } : undefined) },
    authorizer: { authorize: async () => undefined },
    compute: fakeCompute,
    isAdmin: async () => false,
    settings: { mcp: [{ name: 'operations', url: 'http://mcp-operations.svc.cs.internal/mcp' }], outputLimitBytes: 65536, consumerName: 'test.business-task' },
  });
  await bt.api.registerContracts({ occurredAt: new Date().toISOString(), projectId, serviceId, releaseId: 'rel_0123456789abcdef0123456789abcdef' as ReleaseId, tag: 'v0.1.0', commitSha: 'abc', manifest: { apiVersion: 'crewstation/v1', kind: 'DigitalWorker', spec: { service: { command: ['bun'], port: 3000, healthPath: '/healthz', plan: 'p', replicas: 1, releaseMode: 'rolling-compatible' }, env: [], apis: { requested: [] }, subscriptions: [], release: { migration: { compatibility: 'none', destructive: false, rollback: 'switch-back' } }, tasks: { profile: 'coding-medium', defaultVolumeMode: 'follow-container', agentProfiles: [{ name: 'chat-v1', compute: 'sample-opencode', permission: 'read-only' }, { name: 'chat-default', compute: 'default', permission: 'read-only' }], outputContracts: [{ name: 'report-v1', required: ['reports/analysis.md'] }, { name: 'strict-v1', required: ['missing.md'] }] } } } });
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('business-task module', () => {
  test('创建任务、并发子任务、契约校验、交互消息、取消、重试、输出、关闭', async () => {
    const task = await bt.api.createTask(caller, { labels: { issue: '42' } });
    expect(task.state).toBe('creating');
    await expect(bt.api.getTask(stranger, task.id)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(bt.api.createTask(stranger, { labels: {} })).rejects.toMatchObject({ kind: 'forbidden' });
    expect((await bt.api.getTask(caller, task.id)).state).toBe('running');

    await expect(bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'x', agentProfile: 'nope', mode: 'oneshot', prompt: 'hi' })).rejects.toMatchObject({ kind: 'validation' });
    const agent = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'analysis', agentProfile: 'chat-v1', outputContract: 'report-v1', mode: 'oneshot', prompt: '分析' });
    const command = await bt.api.submitSubtask(caller, task.id, { kind: 'command', name: 'tests', command: ['bun', 'test'], timeoutSeconds: 60 });
    const start = commands.find((c) => c.type === 'startAgent') as Extract<RunnerCommand, { type: 'startAgent' }>;
    // 档位由平台解析后再下发，业务只登记了档位名；命令带固定修订与显式二进制（RFC-006）。
    expect(start).toMatchObject({ compute: 'sample-opencode', profileRevision: 1, launch: { protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', model: 'opencode/one' }, permission: 'read-only', mode: 'oneshot', initialPrompt: '分析', mcp: [{ name: 'operations' }] });
    await Bun.sleep(50);
    expect((await bt.api.getSubtask(caller, task.id, command.id))).toMatchObject({ state: 'succeeded', exitCode: 0 });
    expect(await bt.api.subtaskOutput(caller, task.id, command.id)).toBe('done\n');

    expect((await bt.api.getSubtask(caller, task.id, agent.id)).state).toBe('running');
    emit(runnerOf(start), agentEvent(start.agentId, 'session', { sessionId: 'sess-1' }));
    emit(runnerOf(start), agentEvent(start.agentId, 'text', { text: '第一段' }));
    emit(runnerOf(start), agentEvent(start.agentId, 'text', { text: '第二段' }));
    emit(runnerOf(start), agentEvent(start.agentId, 'completed', { result: { exitCode: 0 } }));
    const done = await bt.api.getSubtask(caller, task.id, agent.id);
    expect(done).toMatchObject({ state: 'succeeded', sessionId: 'sess-1', contractResult: { ok: true } });
    expect(await bt.api.subtaskOutput(caller, task.id, agent.id)).toBe('第一段第二段');

    const strict = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'strict', agentProfile: 'chat-v1', outputContract: 'strict-v1', mode: 'oneshot', prompt: 'x' });
    const strictStart = commands.filter((c) => c.type === 'startAgent').at(-1) as Extract<RunnerCommand, { type: 'startAgent' }>;
    emit(runnerOf(strictStart), agentEvent(strictStart.agentId, 'completed'));
    expect(await bt.api.getSubtask(caller, task.id, strict.id)).toMatchObject({ state: 'failed', contractResult: { ok: false, missing: ['missing.md'] } });
    const retried = await bt.api.retrySubtask(caller, task.id, strict.id);
    expect(retried).toMatchObject({ attempt: 2, state: 'running', name: 'strict' });

    const chat = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'chat', agentProfile: 'chat-v1', mode: 'interactive', prompt: '你好' });
    const chatStart = commands.filter((c) => c.type === 'startAgent').at(-1) as Extract<RunnerCommand, { type: 'startAgent' }>;
    emit(runnerOf(chatStart), agentEvent(chatStart.agentId, 'permission'));
    expect((await bt.api.getSubtask(caller, task.id, chat.id)).state).toBe('awaiting-input');
    expect((await bt.api.sendSubtaskMessage(caller, task.id, chat.id, { content: '继续' })).state).toBe('running');
    expect(commands.at(-1)).toMatchObject({ type: 'sendMessage', content: '继续' });
    expect((await bt.api.cancelSubtask(caller, task.id, chat.id)).state).toBe('cancelled');
    await expect(bt.api.sendSubtaskMessage(caller, task.id, chat.id, { content: 'x' })).rejects.toMatchObject({ kind: 'precondition' });

    const failing = await bt.api.submitSubtask(caller, task.id, { kind: 'command', name: 'lint', command: ['sh', '-c', 'fail'], timeoutSeconds: 60 });
    await Bun.sleep(50);
    expect(await bt.api.getSubtask(caller, task.id, failing.id)).toMatchObject({ state: 'failed', exitCode: 2 });
    const finished = (await tdb.db.execute(`SELECT count(*)::int AS n FROM platform_infra.domain_events WHERE topic = 'business-task.subtask-finished'`)) as unknown as Array<{ n: number }>;
    expect(finished[0]!.n).toBeGreaterThanOrEqual(5);

    const closed = await bt.api.closeTask(caller, task.id);
    expect(closed.state).toBe('closed');
    // 业务任务容器释放；每个已结束的 Agent 子任务的执行环境在结束时已交给 task-runtime 回收（RFC-006）。
    expect(released).toContain(task.id);
    const agentRunners = routed.filter((r) => r.command.type === 'startAgent').map((r) => r.taskId);
    expect(agentRunners.every((id) => id !== task.id)).toBe(true);
    // 重试的 strict 在关闭任务时仍在运行：它的执行环境由 task-runtime 随业务任务容器一并回收（父释放先回收子执行环境）。
    expect(agentRunners.filter((id) => released.includes(id))).toHaveLength(agentRunners.length - 1);
    await expect(bt.api.submitSubtask(caller, task.id, { kind: 'command', name: 'late', command: ['ls'], timeoutSeconds: 10 })).rejects.toMatchObject({ kind: 'precondition' });
    expect((await bt.api.listProjectTasks({ userId: 'usr_0123456789abcdef0123456789abcdef' as never, isAdmin: false }, projectId)).length).toBe(1);
  });

  test('容器未连接时子任务留在 pending，TaskRunner 连上后补发', async () => {
    runnerConnected = false;
    const task = await bt.api.createTask(caller, { labels: {} });
    const waiting = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'wait', agentProfile: 'chat-v1', mode: 'oneshot', prompt: '等容器' });
    expect(waiting.state).toBe('pending');
    expect(commands.filter((c) => c.type === 'startAgent' && c.initialPrompt === '等容器')).toHaveLength(0);

    runnerConnected = true;
    expect(await bt.api.dispatchPendingSubtasks(task.id)).toBe(1);
    expect((await bt.api.getSubtask(caller, task.id, waiting.id)).state).toBe('running');
    expect(commands.filter((c) => c.type === 'startAgent' && c.initialPrompt === '等容器')).toHaveLength(1);
    // 再次调用不重复派发。
    expect(await bt.api.dispatchPendingSubtasks(task.id)).toBe(0);
    await bt.api.closeTask(caller, task.id);
  });

  test('登记的档位已被管理员下线：子任务直接失败并列出现有档位，不下发 startAgent（RFC-001）', async () => {
    const task = await bt.api.createTask(caller, { labels: {} });
    computeProfiles = [{ name: 'balanced', revision: 1, isDefault: true }];
    try {
      // 发布时档位存在才登记得下，这里模拟发布之后被管理员删掉：失败要说清还有哪些档位可用。
      const orphan = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'orphan', agentProfile: 'chat-v1', mode: 'oneshot', prompt: '孤儿档位' });
      expect(orphan.state).toBe('failed');
      expect(orphan.error).toContain('算力档位 sample-opencode 不存在');
      // 列出的是现有档位（不论测试状态），不能叫「当前可用」（2026-09-18 实机：测试失败的档位也被列成可用）。
      expect(orphan.error).toContain('现有档位：balanced');
      expect(commands.filter((c) => c.type === 'startAgent' && c.initialPrompt === '孤儿档位')).toHaveLength(0);
    } finally {
      computeProfiles = [{ name: 'sample-opencode', revision: 1, isDefault: true }];
      await bt.api.closeTask(caller, task.id);
    }
  });
  test('固定修订：子任务在构造时固定档位修订，启动按该修订取材料并带 attempt，DTO 只暴露档位名与修订号（RFC-006）', async () => {
    computeProfiles = [{ name: 'sample-opencode', revision: 7, isDefault: true }];
    try {
      const task = await bt.api.createTask(caller, { labels: {} });
      const sub = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'pinned', agentProfile: 'chat-v1', mode: 'oneshot', prompt: '分析' });
      expect(sub).toMatchObject({ compute: 'sample-opencode', profileRevision: 7 });
      const start = commands.filter((c) => c.type === 'startAgent').at(-1) as Extract<RunnerCommand, { type: 'startAgent' }>;
      expect(start).toMatchObject({ profileRevision: 7, beforeStart: { revision: 7, secrets: { KEY: 'sk-business' } } });
      expect(start.processAttemptId).toBe(`${start.agentId}:1`);
      expect(materialRequests.at(-1)).toEqual({ profile: 'sample-opencode', revision: 7 });
      expect(JSON.stringify(sub)).not.toContain('sk-business');
      // 管理员随后保存了新修订：已受理的 attempt 不换修订；重试是新 attempt，按当时的当前修订固定。
      computeProfiles = [{ name: 'sample-opencode', revision: 8, isDefault: true }];
      emit(runnerOf(start), agentEvent(start.agentId, 'error', { error: { message: 'boom' } }));
      expect((await bt.api.getSubtask(caller, task.id, sub.id)).state).toBe('failed');
      const retried = await bt.api.retrySubtask(caller, task.id, sub.id);
      expect(retried).toMatchObject({ attempt: 2, profileRevision: 8 });
      const retryStart = commands.filter((c) => c.type === 'startAgent').at(-1) as Extract<RunnerCommand, { type: 'startAgent' }>;
      expect(retryStart).toMatchObject({ profileRevision: 8, processAttemptId: `${retryStart.agentId}:2` });
      await bt.api.closeTask(caller, task.id);
    } finally { computeProfiles = [{ name: 'sample-opencode', revision: 1, isDefault: true }]; }
  });

  test('Manifest 写 default：每次受理时解析到当时的默认档位；没有默认档位时子任务失败并写明原因（C17）', async () => {
    const task = await bt.api.createTask(caller, { labels: {} });
    try {
      const first = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'd1', agentProfile: 'chat-default', mode: 'oneshot', prompt: '默认一' });
      expect(first).toMatchObject({ compute: 'sample-opencode', profileRevision: 1 });
      computeProfiles = [{ name: 'sample-opencode', revision: 1 }, { name: 'bigger', revision: 3, isDefault: true }];
      const second = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'd2', agentProfile: 'chat-default', mode: 'oneshot', prompt: '默认二' });
      expect(second).toMatchObject({ compute: 'bigger', profileRevision: 3 });
      expect(commands.filter((c) => c.type === 'startAgent').at(-1)).toMatchObject({ compute: 'bigger', initialPrompt: '默认二' });
      computeProfiles = [{ name: 'sample-opencode', revision: 1 }];
      const orphan = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'd3', agentProfile: 'chat-default', mode: 'oneshot', prompt: '默认三' });
      expect(orphan).toMatchObject({ state: 'failed' });
      expect(orphan.error).toContain('平台尚未设置默认算力档位');
      expect(commands.filter((c) => c.type === 'startAgent' && c.initialPrompt === '默认三')).toHaveLength(0);
    } finally {
      computeProfiles = [{ name: 'sample-opencode', revision: 1, isDefault: true }];
      await bt.api.closeTask(caller, task.id);
    }
  });

  test('Agent 子任务各自一个执行环境（RFC-006 §5.4）：额度满直接失败并写明原因；子 Runner 未连上时等待，连上后派发', async () => {
    const task = await bt.api.createTask(caller, { labels: {} });
    try {
      executionControls.reject = quotaExceeded('项目并发额度已满，子任务未启动；请稍后重试');
      const full = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'full', agentProfile: 'chat-v1', mode: 'oneshot', prompt: '额度满' });
      expect(full).toMatchObject({ state: 'failed', error: '启动 Agent 失败：项目并发额度已满，子任务未启动；请稍后重试' });
      executionControls.reject = undefined;
      executionControls.connected = false;
      const waiting = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'wait-child', agentProfile: 'chat-v1', mode: 'interactive', prompt: '等子 Runner' });
      expect(waiting.state).toBe('pending');
      expect(routed.filter((r) => r.command.type === 'startAgent' && r.command.initialPrompt === '等子 Runner')).toHaveLength(0);
      await expect(bt.api.sendSubtaskMessage(caller, task.id, waiting.id, { content: 'x' })).rejects.toMatchObject({ kind: 'precondition' });
      const [executionId, execution] = [...executions.entries()].at(-1)!;
      expect(execution.native?.state).toBe('queued');
      execution.connected = true; execution.state = 'running'; execution.native = { state: 'running' };
      expect(await bt.api.dispatchPendingSubtasks(executionId as never)).toBe(1);
      const start = routed.find((r) => r.command.type === 'startAgent' && r.command.initialPrompt === '等子 Runner')!;
      expect(start.taskId).toBe(executionId);
      expect((await bt.api.getSubtask(caller, task.id, waiting.id)).state).toBe('running');
      await bt.api.sendSubtaskMessage(caller, task.id, waiting.id, { content: '继续' });
      expect(routed.at(-1)).toMatchObject({ taskId: executionId, command: { type: 'sendMessage', content: '继续' } });
    } finally {
      executionControls.connected = true; executionControls.reject = undefined;
      await bt.api.closeTask(caller, task.id);
    }
  });

  test('执行环境在 Agent 结束前没了（业务任务暂停、Pod 丢失）：子任务失败并带原因；未开始的子任务取消即回收执行环境', async () => {
    const task = await bt.api.createTask(caller, { labels: {} });
    try {
      const running = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'lost', agentProfile: 'chat-v1', mode: 'oneshot', prompt: '会丢' });
      const executionId = routed.find((r) => r.command.type === 'startAgent' && r.command.initialPrompt === '会丢')!.taskId;
      const env = executions.get(executionId)!;
      env.connected = false; env.state = 'releasing'; env.native = { state: 'cleaning', failureReason: '业务任务已暂停，此子任务的执行环境随之结束' };
      expect(await bt.api.getSubtask(caller, task.id, running.id)).toMatchObject({ state: 'failed', error: '业务任务已暂停，此子任务的执行环境随之结束' });

      executionControls.connected = false;
      const pending = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'never', agentProfile: 'chat-v1', mode: 'oneshot', prompt: '不会起' });
      const pendingExecution = [...executions.keys()].at(-1)!;
      const before = routed.length;
      expect((await bt.api.cancelSubtask(caller, task.id, pending.id)).state).toBe('cancelled');
      expect(routed.slice(before).filter((r) => r.command.type === 'cancelAgent')).toHaveLength(0);
      expect(released).toContain(pendingExecution);
    } finally {
      executionControls.connected = true;
      await bt.api.closeTask(caller, task.id);
    }
  });
});

test.skipIf(!available)('业务子任务按所属项目校验档位；拒绝后不派发，恢复授权的重试重新校验', async () => {
  const task = await bt.api.createTask(caller, { labels: {} });
  try {
    denyCompute = true;
    const count = commands.length;
    const sub = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'denied', agentProfile: 'chat-v1', mode: 'oneshot', prompt: '项目授权' });
    expect(sub).toMatchObject({ state: 'failed', error: expect.stringContaining('未获授权') });
    expect(computeProjects.at(-1)).toBe(projectId); expect(commands.length).toBe(count);
    denyCompute = false;
    const retried = await bt.api.retrySubtask(caller, task.id, sub.id);
    expect(retried.state).toBe('running'); expect(computeProjects.at(-1)).toBe(projectId);
  } finally { denyCompute = false; await bt.api.closeTask(caller, task.id); }
});
