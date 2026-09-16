import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ReleaseId, RunnerCommand, RunnerEvent, RuntimeRevisionRef, ServiceActor, ServiceId, TaskId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
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
const events = new Map<string, Array<{ seq: number; at: string; event: RunnerEvent }>>();
const released: string[] = [];
const emit = (taskId: string, event: RunnerEvent) => { const list = events.get(taskId) ?? []; list.push({ seq: list.length + 1, at: new Date().toISOString(), event }); events.set(taskId, list); };
const agentEvent = (agentId: string, type: string, extra: Record<string, unknown> = {}): RunnerEvent => ({ kind: 'agent', event: { agentId, seq: 0, at: new Date().toISOString(), type, ...extra } as never });

let runnerConnected = true;
/** 可变：用来验证「登记时存在、起子任务时被管理员删掉」的档位（RFC-001）。 */
let computeProfiles = ['sample-stub'];
/** RFC-004：设置后档位视为托管，子任务在构造时固定该版本。 */
let managedRuntime: RuntimeRevisionRef | undefined;
const materialRequests: RuntimeRevisionRef[] = [];

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, businessTaskMigrations]);
  bt = createBusinessTaskModule({
    db: tdb.db,
    environments: {
      createEnvironment: async (input) => ({ id: `tsk_${Bun.randomUUIDv7().replace(/-/g, '')}` as TaskId, projectId, state: 'running', connected: true, traceId: input.traceId ?? '0123456789abcdef0123456789abcdef', podName: 'task-1' }),
      releaseEnvironment: async (taskId) => { released.push(taskId); return { id: taskId, projectId, state: 'released', connected: false, traceId: 't', podName: 'task-1' }; },
      pauseEnvironment: async (taskId) => ({ id: taskId, projectId, state: 'paused', connected: false, traceId: 't', podName: 'task-1' }),
      resumeEnvironment: async (taskId) => ({ id: taskId, projectId, state: 'creating', connected: false, traceId: 't', podName: 'task-1' }),
      getEnvironment: async (taskId) => ({ id: taskId, projectId, state: runnerConnected ? 'running' : 'creating', connected: runnerConnected, traceId: 't', podName: 'task-1' }),
    },
    runner: {
      sendCommand: async (taskId, command) => {
        commands.push(command);
        if (command.type === 'exec') { emit(taskId, { kind: 'execExited', execId: command.execId, exitCode: command.command.includes('fail') ? 2 : 0, durationMs: 5 }); return { execId: command.execId, exitCode: command.command.includes('fail') ? 2 : 0, stdout: 'done\n', stderr: '', durationMs: 5, truncated: false }; }
        if (command.type === 'verifyContract') return { ok: !command.contract.required.includes('missing.md'), missing: command.contract.required.filter((f) => f === 'missing.md'), schemaErrors: [] };
        return {};
      },
      listEvents: async (taskId, options) => (events.get(taskId) ?? []).filter((e) => (!options?.kinds || options.kinds.includes(e.event.kind)) && (!options?.agentId || (e.event.kind === 'agent' && e.event.event.agentId === options.agentId))),
    },
    directory: { resolveServiceIdentity: async (identity) => (identity === 'demo/demo' ? { serviceId, projectId } : undefined) },
    authorizer: { authorize: async () => undefined },
    compute: { resolve: async (name: string) => (computeProfiles.includes(name) ? { name, driver: 'stub' as const, model: 'stub/echo', ...(managedRuntime ? { runtime: managedRuntime } : {}) } : undefined), runtimeMaterial: async (ref) => { materialRequests.push(ref); return { configId: ref.configId, configName: 'gw', revision: ref.revision, driver: 'opencode', contentHash: 'h', steps: [], vars: {}, secrets: { KEY: 'sk-business' }, configFile: { kind: 'none' }, captureOutput: false }; }, list: async () => computeProfiles.map((name) => ({ name })) },
    isAdmin: async () => false,
    settings: { mcp: [{ name: 'operations', url: 'http://mcp-operations.svc.cs.internal/mcp' }], outputLimitBytes: 65536, consumerName: 'test.business-task' },
  });
  await bt.api.registerContracts({ occurredAt: new Date().toISOString(), projectId, serviceId, releaseId: 'rel_0123456789abcdef0123456789abcdef' as ReleaseId, tag: 'v0.1.0', commitSha: 'abc', manifest: { apiVersion: 'crewstation/v1', kind: 'DigitalWorker', spec: { service: { command: ['bun'], port: 3000, healthPath: '/healthz', plan: 'p', replicas: 1, releaseMode: 'rolling-compatible' }, env: [], apis: { requested: [] }, subscriptions: [], release: { migration: { compatibility: 'none', destructive: false, rollback: 'switch-back' } }, tasks: { profile: 'coding-medium', defaultVolumeMode: 'follow-container', agentProfiles: [{ name: 'chat-v1', compute: 'sample-stub', permission: 'read-only' }], outputContracts: [{ name: 'report-v1', required: ['reports/analysis.md'] }, { name: 'strict-v1', required: ['missing.md'] }] } } } });
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
    // 档位由平台解析后再下发，业务只登记了档位名（RFC-001）。
    expect(start).toMatchObject({ compute: 'sample-stub', driver: 'stub', model: 'stub/echo', permission: 'read-only', mode: 'oneshot', initialPrompt: '分析', mcp: [{ name: 'operations' }] });
    await Bun.sleep(50);
    expect((await bt.api.getSubtask(caller, task.id, command.id))).toMatchObject({ state: 'succeeded', exitCode: 0 });
    expect(await bt.api.subtaskOutput(caller, task.id, command.id)).toBe('done\n');

    expect((await bt.api.getSubtask(caller, task.id, agent.id)).state).toBe('running');
    emit(task.id, agentEvent(start.agentId, 'session', { sessionId: 'sess-1' }));
    emit(task.id, agentEvent(start.agentId, 'text', { text: '第一段' }));
    emit(task.id, agentEvent(start.agentId, 'text', { text: '第二段' }));
    emit(task.id, agentEvent(start.agentId, 'completed', { result: { exitCode: 0 } }));
    const done = await bt.api.getSubtask(caller, task.id, agent.id);
    expect(done).toMatchObject({ state: 'succeeded', sessionId: 'sess-1', contractResult: { ok: true } });
    expect(await bt.api.subtaskOutput(caller, task.id, agent.id)).toBe('第一段第二段');

    const strict = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'strict', agentProfile: 'chat-v1', outputContract: 'strict-v1', mode: 'oneshot', prompt: 'x' });
    const strictStart = commands.filter((c) => c.type === 'startAgent').at(-1) as Extract<RunnerCommand, { type: 'startAgent' }>;
    emit(task.id, agentEvent(strictStart.agentId, 'completed'));
    expect(await bt.api.getSubtask(caller, task.id, strict.id)).toMatchObject({ state: 'failed', contractResult: { ok: false, missing: ['missing.md'] } });
    const retried = await bt.api.retrySubtask(caller, task.id, strict.id);
    expect(retried).toMatchObject({ attempt: 2, state: 'running', name: 'strict' });

    const chat = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'chat', agentProfile: 'chat-v1', mode: 'interactive', prompt: '你好' });
    const chatStart = commands.filter((c) => c.type === 'startAgent').at(-1) as Extract<RunnerCommand, { type: 'startAgent' }>;
    emit(task.id, agentEvent(chatStart.agentId, 'permission'));
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
    expect(released).toEqual([task.id]);
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
    computeProfiles = ['balanced'];
    try {
      // 发布时档位存在才登记得下，这里模拟发布之后被管理员删掉：失败要说清还有哪些档位可用。
      const orphan = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'orphan', agentProfile: 'chat-v1', mode: 'oneshot', prompt: '孤儿档位' });
      expect(orphan.state).toBe('failed');
      expect(orphan.error).toContain('算力档位 sample-stub 不存在');
      expect(orphan.error).toContain('balanced');
      expect(commands.filter((c) => c.type === 'startAgent' && c.initialPrompt === '孤儿档位')).toHaveLength(0);
    } finally {
      computeProfiles = ['sample-stub'];
      await bt.api.closeTask(caller, task.id);
    }
  });
  test('托管档位：子任务在构造时固定运行版本，启动按该版本取材料并带 attempt，DTO 只暴露版本引用（RFC-004）', async () => {
    managedRuntime = { configId: 'arc_' + 'a'.repeat(32), revision: 7 };
    try {
      const task = await bt.api.createTask(caller, { labels: {} });
      const sub = await bt.api.submitSubtask(caller, task.id, { kind: 'agent', name: 'managed', agentProfile: 'chat-v1', mode: 'oneshot', prompt: '分析' });
      expect(sub.runtime).toEqual(managedRuntime);
      const start = commands.filter((c) => c.type === 'startAgent').at(-1) as Extract<RunnerCommand, { type: 'startAgent' }>;
      expect(start.runtime).toMatchObject({ revision: 7, secrets: { KEY: 'sk-business' } });
      expect(start.processAttemptId).toBe(`${start.agentId}:1`);
      expect(materialRequests.at(-1)).toEqual(managedRuntime);
      expect(JSON.stringify(sub)).not.toContain('sk-business');
      // 已启用版本随后变化：已受理的 attempt 不换版本；重试是新 attempt，按当时的已启用版本固定。
      managedRuntime = { configId: managedRuntime.configId, revision: 8 };
      emit(task.id, agentEvent(start.agentId, 'error', { error: { message: 'boom' } }));
      expect((await bt.api.getSubtask(caller, task.id, sub.id)).state).toBe('failed');
      const retried = await bt.api.retrySubtask(caller, task.id, sub.id);
      expect(retried).toMatchObject({ attempt: 2, runtime: { revision: 8 } });
      const retryStart = commands.filter((c) => c.type === 'startAgent').at(-1) as Extract<RunnerCommand, { type: 'startAgent' }>;
      expect(retryStart.processAttemptId).toBe(`${retryStart.agentId}:2`);
      expect(retryStart.runtime?.revision).toBe(8);
      await bt.api.closeTask(caller, task.id);
    } finally { managedRuntime = undefined; }
  });
});
