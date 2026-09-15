import { expect, test } from 'bun:test';
import { NativeTerminalDtoSchema } from '@crewstation/contracts';
import { fixedClock, forbidden, quotaExceeded } from '@crewstation/kernel';
import { nativeTerminalUseCases } from '../application/nativeTerminals';
import { isolatedNativeFixture } from './isolatedNativeFixture';
import { workspaceActor as actor, workspaceTask as taskId } from './workspaceFixture';

test('每窗独立受理和派发，HTTP 先返回准备中；MCP 和数据身份仍是父工作区', async () => {
  const f = isolatedNativeFixture(), input = f.input();
  const first = NativeTerminalDtoSchema.parse(await f.api.startNativeTerminal(actor, taskId, input));
  expect(first).toMatchObject({ lifecycle: 'starting', execution: { state: 'queued' } });
  expect(f.allocations).toEqual([]); expect(f.commands).toEqual([]);
  f.controls.model = 'opencode/two'; f.controls.taskProfile = 'changed';
  expect((await f.api.startNativeTerminal(actor, taskId, input)).agentId).toBe(first.agentId);
  await f.run(first);
  expect(f.allocations).toEqual([first.execution!.taskId]);
  expect((await f.api.listNativeTerminals(actor, taskId)).items[0]).toMatchObject({ lifecycle: 'running', connection: 'connected', execution: { profile: { name: 'cli-small' } } });
  expect(f.commands.find((r) => r.command.type === 'startAgentTerminal')).toMatchObject({ taskId: first.execution!.taskId, command: { runnerId: first.runnerId, model: 'opencode/one', permission: 'edit' } });
  expect(f.issued).toEqual([expect.objectContaining({ taskId, userId: actor.userId })]);
  await expect(f.api.startNativeTerminal(actor, taskId, { ...input, permission: 'full' })).rejects.toMatchObject({ kind: 'conflict' });
  expect(first).not.toHaveProperty('model'); expect(first).not.toHaveProperty('driver');
});

test('父 Runner 断线或更换不影响子 CLI；仅一窗失联时另一窗继续运行', async () => {
  const f = isolatedNativeFixture(), one = await f.start(), two = await f.start();
  f.state.connected = false;
  let records = (await f.api.listNativeTerminals(actor, taskId)).items;
  expect(records.every((r) => r.lifecycle === 'running' && r.connection === 'connected')).toBe(true);
  f.controls.offline.add(one.execution!.taskId);
  records = (await f.api.listNativeTerminals(actor, taskId)).items;
  expect(records.find((r) => r.agentId === one.agentId)).toMatchObject({ lifecycle: 'unknown', connection: 'unknown' });
  expect(records.find((r) => r.agentId === two.agentId)).toMatchObject({ lifecycle: 'running', connection: 'connected' });
  await f.api.stopNativeTerminal(actor, taskId, two.agentId); await f.run(two);
  expect(f.releases).toEqual([two.execution!.taskId]);
  expect(f.environments.has(one.execution!.taskId)).toBe(true); expect(f.state.released).toBe(false);
});

test('创建回执丢失和派发回执丢失由持久身份接续，API 重试不会再分配或多开进程', async () => {
  const f = isolatedNativeFixture(); f.controls.loseCreate = true;
  const input = f.input(), terminal = await f.api.startNativeTerminal(actor, taskId, input);
  await f.run(terminal); expect(f.allocations).toHaveLength(1);
  const recovered = nativeTerminalUseCases(f.deps, f.repository);
  f.controls.loseStart = true;
  await recovered.dispatchPendingNativeExecution(terminal.execution!.taskId);
  await recovered.dispatchPendingNativeExecution(terminal.execution!.taskId);
  expect((await recovered.startNativeTerminal(actor, taskId, input)).agentId).toBe(terminal.agentId);
  expect(f.allocations).toHaveLength(1);
  expect(f.commands.filter((r) => r.command.type === 'startAgentTerminal')).toHaveLength(1);
});

test('配额拒绝只结束本次请求；原 ID 不重跑，新请求可恢复', async () => {
  const f = isolatedNativeFixture(); const running = await f.start();
  f.controls.reject = quotaExceeded('额度已满');
  const input = f.input(), rejected = await f.api.startNativeTerminal(actor, taskId, input); await f.run(rejected);
  expect((await f.api.listNativeTerminals(actor, taskId)).items.find((r) => r.agentId === rejected.agentId)).toMatchObject({ lifecycle: 'failed', reason: 'start-failed', error: '额度已满', finalScreen: 'unavailable' });
  f.controls.reject = undefined;
  expect((await f.api.startNativeTerminal(actor, taskId, input)).lifecycle).toBe('failed'); await f.run(rejected);
  expect(f.allocations).toEqual([running.execution!.taskId]);
  await f.start(); expect(f.allocations).toHaveLength(2);
});

test('停止未准入的窗口不分配容器；创建期间停止和另一控制器派发不会留下执行资源', async () => {
  const f = isolatedNativeFixture(), before = await f.api.startNativeTerminal(actor, taskId, f.input());
  await f.api.stopNativeTerminal(actor, taskId, before.agentId); await f.run(before);
  expect(f.allocations).toEqual([]);
  let release!: () => void, entered!: () => void;
  const entering = new Promise<void>((done) => { entered = done; });
  f.controls.beforeCreate = async () => { entered(); await new Promise<void>((done) => { release = done; }); };
  const pending = await f.api.startNativeTerminal(actor, taskId, f.input()), starting = f.run(pending); await entering;
  await f.api.stopNativeTerminal(actor, taskId, pending.agentId);
  const second = nativeTerminalUseCases(f.deps, f.repository).dispatchPendingNativeExecution(pending.execution!.taskId);
  f.deps.clock = fixedClock('2026-09-13T00:01:00Z'); release(); await starting;
  f.deps.clock = fixedClock('2026-09-13T00:02:00Z'); await second; await f.run(pending);
  expect(f.commands.filter((r) => r.command.type === 'startAgentTerminal')).toEqual([]);
  expect(f.releases).toEqual([pending.execution!.taskId]);
});

test('正常退出先保存有界末屏再清理，清理回执丢失仍可按原身份重试', async () => {
  const f = isolatedNativeFixture(), terminal = await f.start(); f.ended(terminal); f.controls.loseRelease = true;
  await f.run(terminal);
  expect(await f.api.getNativeTerminalSnapshot(actor, taskId, terminal.agentId)).toMatchObject({ status: 'available', snapshot: { terminalId: terminal.terminalId, data: `final ${terminal.execution!.taskId}` } });
  expect(f.steps.indexOf(`snapshot:${terminal.execution!.taskId}`)).toBeLessThan(f.steps.indexOf(`release:${terminal.execution!.taskId}`));
  await nativeTerminalUseCases(f.deps, f.repository).dispatchPendingNativeExecution(terminal.execution!.taskId);
  expect((await f.repository.findAgent(taskId, terminal.agentId))?.execution?.finalized).toBe(true);
  expect(f.releases).toHaveLength(1); expect(f.commands.filter((r) => r.command.type === 'startAgentTerminal')).toHaveLength(1);
});

test('OOM 保留明确的单窗故障和末屏不可用事实，其他 CLI 不结束', async () => {
  const f = isolatedNativeFixture(), one = await f.start(), two = await f.start();
  const env = f.environments.get(one.execution!.taskId)!; env.connected = false; env.state = 'failed'; env.native!.state = 'finished'; env.native!.failureReason = 'OOMKilled';
  await f.run(one);
  const records = (await f.api.listNativeTerminals(actor, taskId)).items;
  expect(records.find((r) => r.agentId === one.agentId)).toMatchObject({ lifecycle: 'failed', reason: 'environment-failed', error: 'OOMKilled', finalScreen: 'unavailable' });
  expect(records.find((r) => r.agentId === two.agentId)).toMatchObject({ lifecycle: 'running', connection: 'connected' });
  expect(f.state.released).toBe(false);
});

test('末屏临时失败先重试，超过保存期限释放配额并明确不可用；无权不能读末屏或停止', async () => {
  const f = isolatedNativeFixture(), terminal = await f.start(); f.ended(terminal); f.controls.noSnapshot = true;
  await f.run(terminal); expect(f.releases).toEqual([]);
  expect(await f.api.getNativeTerminalSnapshot(actor, taskId, terminal.agentId)).toEqual({ status: 'pending' });
  f.deps.clock = fixedClock('2026-09-13T00:00:31Z'); await f.run(terminal);
  expect(f.releases).toEqual([terminal.execution!.taskId]);
  expect(await f.api.getNativeTerminalSnapshot(actor, taskId, terminal.agentId)).toEqual({ status: 'unavailable' });
  f.deps.authorizer.authorize = async () => { throw forbidden(); };
  await expect(f.api.getNativeTerminalSnapshot(actor, taskId, terminal.agentId)).rejects.toMatchObject({ kind: 'forbidden' });
  await expect(f.api.stopNativeTerminal(actor, taskId, terminal.agentId)).rejects.toMatchObject({ kind: 'forbidden' });
});
