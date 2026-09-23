import { expect, test } from 'bun:test';
import type { BeforeStartExecution, NativeTerminalRecord, RunnerEvent, StartupRecord, StartupStage } from '@crewstation/contracts';
import { DevSessionDtoSchema, NativeTerminalDtoSchema } from '@crewstation/contracts';
import { STARTING_ROSTER_MS } from '../application/nativeExecution';
import { sessionLifecycleUseCases } from '../application/sessionLifecycle';
import { isolatedNativeFixture } from './isolatedNativeFixture';
import { workspaceActor as actor, workspaceFixture, workspaceProject, workspaceTask as taskId } from './workspaceFixture';

const at = (second: number) => new Date(Date.UTC(2026, 8, 23, 3, 0, 0) + second * 1000).toISOString();
const done = (kind: StartupStage['kind'], from: number, to: number): StartupStage => ({ kind, state: 'succeeded', startedAt: at(from), endedAt: at(to), durationMs: Math.round((to - from) * 1000) });
const connected: StartupRecord = { state: 'ready', startedAt: at(1), endedAt: at(5.2), stages: [done('queue', 1, 1.5), done('container', 1.5, 4.6), done('connect', 4.6, 5.2), done('ready', 5.2, 5.2)] };
const execution = (agentId: string, state: BeforeStartExecution['state'], stepState: 'running' | 'succeeded' | 'failed'): BeforeStartExecution => ({
  executionId: 'exec', agentId, processAttemptId: 'p', profile: { profileId: '01a0bf5d-8f4b-7001-8458-107366e7de39', revision: 1 } as BeforeStartExecution['profile'], state, queuedAt: at(5.2), startedAt: at(5.3),
  ...(state === 'running' ? { currentStepId: 's0' } : { endedAt: at(5.7) }), steps: [{ stepId: 's0', name: '安装依赖', kind: 'script', state: stepState } as BeforeStartExecution['steps'][number]],
  ...(state === 'failed' ? { error: { message: '退出码 1' } as BeforeStartExecution['error'] } : {}),
});

async function startingCli() {
  const f = isolatedNativeFixture(), terminal = await f.start(), executionTaskId = terminal.execution!.taskId;
  f.environments.get(executionTaskId)!.startup = connected;
  const record = f.rosters.get(executionTaskId)!.terminals[0]!;
  record.lifecycle = 'starting';
  const events: Array<{ seq: number; at: string; event: RunnerEvent }> = [], reads: string[] = [];
  f.deps.runner.listEvents = async (id, options) => { reads.push(`${id}:${options?.kinds?.join(',')}`); return structuredClone(events); };
  return { f, terminal, executionTaskId, record, events, reads };
}

test('名册带六段启动进度：执行环境的前三段加上 Runner 的启动前步骤与进程拉起；就绪即冻结，之后不再读事件', async () => {
  const { f, terminal, executionTaskId, record, events, reads } = await startingCli();
  events.push({ seq: 1, at: at(5.3), event: { kind: 'beforeStart', execution: execution(terminal.agentId, 'running', 'running') } });
  let item = NativeTerminalDtoSchema.parse((await f.api.listNativeTerminals(actor, taskId)).items[0]);
  expect(item.startup?.state).toBe('running');
  expect(item.startup?.observedAt).toBe(f.deps.clock.now().toISOString());
  expect(item.startup?.stages.map((stage) => `${stage.kind}:${stage.state}`)).toEqual(['queue:succeeded', 'container:succeeded', 'connect:succeeded', 'prepare:running', 'agent:pending', 'ready:pending']);
  expect(item.startup?.stages[3]).toMatchObject({ count: { done: 0, total: 1 }, detail: '安装依赖' });
  expect(reads).toEqual([`${executionTaskId}:beforeStart,nativeTerminal`]);
  expect((await f.repository.findExecution(executionTaskId))!.execution!.startup).toBeUndefined();

  events.push({ seq: 2, at: at(5.7), event: { kind: 'beforeStart', execution: execution(terminal.agentId, 'succeeded', 'succeeded') } },
    { seq: 3, at: at(10.5), event: { kind: 'nativeTerminal', terminal: { ...(record as NativeTerminalRecord), lifecycle: 'running', revision: 5 } } },
    { seq: 4, at: at(11), event: { kind: 'nativeTerminal', terminal: { ...(record as NativeTerminalRecord), lifecycle: 'running', revision: 6 } } });
  record.lifecycle = 'running';
  item = NativeTerminalDtoSchema.parse((await f.api.listNativeTerminals(actor, taskId)).items[0]);
  expect(item.startup).toMatchObject({ state: 'ready', endedAt: at(10.5) });
  expect(item.startup?.stages.at(-2)).toEqual({ kind: 'agent', state: 'succeeded', startedAt: at(5.7), endedAt: at(10.5), durationMs: 4800 });
  const frozen = (await f.repository.findExecution(executionTaskId))!.execution!.startup!;
  expect(frozen.state).toBe('ready');
  await f.api.listNativeTerminals(actor, taskId);
  expect(reads).toHaveLength(2);
});

test('排队分配容器从受理时刻算起：Runner 回报的记录把 startedAt 改成进程启动时间之后，排队段与整体开始时间不变', async () => {
  const { f, executionTaskId, record } = await startingCli();
  const acceptedAt = (await f.repository.findExecution(executionTaskId))!.execution!.acceptedAt!;
  expect(acceptedAt).toBeDefined();
  const t = (second: number) => new Date(Date.parse(acceptedAt) + second * 1000).toISOString();
  const span = (kind: StartupStage['kind'], from: number, to: number): StartupStage => ({ kind, state: 'succeeded', startedAt: t(from), endedAt: t(to), durationMs: Math.round((to - from) * 1000) });
  f.environments.get(executionTaskId)!.startup = { state: 'ready', startedAt: t(0.5), endedAt: t(4), stages: [span('queue', 0.5, 1), span('container', 1, 3), span('connect', 3, 4), span('ready', 4, 4)] };
  // Runner 的记录带它自己的 startedAt（进程启动时间，晚于受理）；读名册时它会被存成受理记录（2026-09-23 实机：排队段因此成了 0 毫秒）。
  Object.assign(record, { startedAt: t(5), revision: record.revision + 1 });
  await f.api.listNativeTerminals(actor, taskId);
  const item = NativeTerminalDtoSchema.parse((await f.api.listNativeTerminals(actor, taskId)).items[0]);
  expect((await f.repository.findExecution(executionTaskId))!.record.startedAt).toBe(t(5));
  expect(item.startup?.startedAt).toBe(acceptedAt);
  expect(item.startup?.stages[0]).toEqual({ kind: 'queue', state: 'succeeded', startedAt: acceptedAt, endedAt: t(1), durationMs: 1000 });
  expect(item.startup?.stages[1]).toMatchObject({ kind: 'container', startedAt: t(1) });
});

test('启动中 Runner 回名册慢：名册不等它（约 1 秒即返回、按已连接），进度照常从事件读；同一执行环境并发读只问一次', async () => {
  const { f, terminal, executionTaskId, events } = await startingCli();
  events.push({ seq: 1, at: at(5.3), event: { kind: 'beforeStart', execution: execution(terminal.agentId, 'running', 'running') } });
  // 受理记录也还在启动中（Runner 回启动命令时进程还没拉起）。
  const stored = (await f.repository.findExecution(executionTaskId))!.record;
  await f.repository.saveRecord(taskId, { ...stored, lifecycle: 'starting', revision: stored.revision + 1 });
  const original = f.deps.runner.sendCommand, asked: string[] = [];
  let answer: (() => void) | undefined;
  f.deps.runner.sendCommand = async (id, command) => {
    if (command.type !== 'listAgentTerminals' || id !== executionTaskId) return original(id, command);
    asked.push(id);
    await new Promise<void>((resolve) => { answer = resolve; });
    return original(id, command);
  };
  const started = Date.now();
  const [first, second] = await Promise.all([f.api.listNativeTerminals(actor, taskId), f.api.listNativeTerminals(actor, taskId)]);
  const waited = Date.now() - started;
  expect(waited).toBeGreaterThanOrEqual(STARTING_ROSTER_MS - 50);
  expect(waited).toBeLessThan(STARTING_ROSTER_MS + 900);
  expect(asked).toEqual([executionTaskId]);
  for (const list of [first, second]) {
    const item = NativeTerminalDtoSchema.parse(list.items[0]);
    expect(item).toMatchObject({ lifecycle: 'starting', connection: 'connected' });
    expect(item.startup?.stages.map((stage) => `${stage.kind}:${stage.state}`)).toEqual(['queue:succeeded', 'container:succeeded', 'connect:succeeded', 'prepare:running', 'agent:pending', 'ready:pending']);
  }
  // Runner 终于回话：之后的读照常用它的名册；已拉起的 CLI 不受这个上限影响。
  answer!();
  await Bun.sleep(0);
  f.deps.runner.sendCommand = original;
  expect((await f.api.listNativeTerminals(actor, taskId)).items[0]).toMatchObject({ connection: 'connected' });
});

test('启动前步骤失败：冻结为失败，回收执行环境之前留下主容器日志的尾部', async () => {
  const { f, terminal, executionTaskId, record, events } = await startingCli();
  events.push({ seq: 1, at: at(5.7), event: { kind: 'beforeStart', execution: execution(terminal.agentId, 'failed', 'failed') } });
  Object.assign(record, { lifecycle: 'failed', reason: 'before-start-failed', error: '环境准备失败：步骤 s0，退出码 1', endedAt: at(5.8), revision: record.revision + 1 });
  const captured: string[] = [];
  f.deps.environments.captureStartupLog = async (id) => { captured.push(id); f.steps.push(`log:${id}`); return 'npm ERR! code E404'; };
  await f.run(terminal);
  await f.run(terminal);
  const saved = (await f.repository.findExecution(executionTaskId))!.execution!.startup!;
  expect(saved.state).toBe('failed');
  expect(saved.stages[3]).toMatchObject({ kind: 'prepare', state: 'failed', logTail: 'npm ERR! code E404', error: { code: 'before-start-failed', message: '启动前步骤「安装依赖」失败：退出码 1' } });
  expect(captured).toEqual([executionTaskId]);
  expect(f.steps.indexOf(`log:${executionTaskId}`)).toBeLessThan(f.steps.indexOf(`release:${executionTaskId}`));
  // 已留下日志的不再重复读。
  await f.api.reconcileNativeExecutions();
  expect(captured).toHaveLength(1);
});

test('没人读过名册、记录已经结束时直接回收：回收前照样算出并冻结启动进度，留下日志（RFC-022 实机：原来留不留看时序）', async () => {
  const { f, terminal, executionTaskId, events } = await startingCli();
  events.push({ seq: 1, at: at(5.7), event: { kind: 'beforeStart', execution: execution(terminal.agentId, 'failed', 'failed') } });
  const stored = (await f.repository.findExecution(executionTaskId))!.record;
  await f.repository.saveRecord(taskId, { ...stored, lifecycle: 'failed', reason: 'before-start-failed', error: '环境准备失败', endedAt: at(5.8), revision: stored.revision + 1 });
  f.deps.environments.captureStartupLog = async () => '{"level":"warn","msg":"before-start step failed"}';
  await f.run(terminal);
  const frozen = (await f.repository.findExecution(executionTaskId))!.execution!.startup!;
  expect(frozen.state).toBe('failed');
  expect(frozen.stages.find((stage) => stage.state === 'failed')).toMatchObject({ kind: 'prepare', logTail: '{"level":"warn","msg":"before-start step failed"}' });
});

test('升级前受理的执行环境没有启动进度：名册不读事件、不带 startup', async () => {
  const f = isolatedNativeFixture(), reads: string[] = [];
  f.deps.runner.listEvents = async (id) => { reads.push(id); return []; };
  await f.start();
  expect((await f.api.listNativeTerminals(actor, taskId)).items[0]!.startup).toBeUndefined();
  expect(reads).toEqual([]);
});

test('开发会话 DTO 带 task-runtime 产出的五段与读出时刻；升级前的会话没有', async () => {
  const f = workspaceFixture();
  f.state.connected = false;
  const session = sessionLifecycleUseCases(f.deps), original = f.deps.environments.findDevSession;
  const checkout: StartupRecord = { state: 'running', startedAt: at(0), stages: [done('queue', 0, 0.1), done('container', 0.1, 3), { kind: 'checkout', state: 'running', startedAt: at(3), subject: 'main', detail: '正在克隆分支 main' }, { kind: 'connect', state: 'pending' }, { kind: 'ready', state: 'pending' }] };
  f.deps.environments.findDevSession = async (...args) => { const env = await original(...args); return env ? { ...env, state: 'creating', startup: checkout } : env; };
  const dto = DevSessionDtoSchema.parse(await session.getSession(actor, workspaceProject));
  expect(dto.startup).toEqual({ ...checkout, observedAt: f.deps.clock.now().toISOString() });
  f.deps.environments.findDevSession = original;
  expect((await session.getSession(actor, workspaceProject))!.startup).toBeUndefined();
});
