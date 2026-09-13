import { expect, test } from 'bun:test';
import type { UserId } from '@crewstation/contracts';
import { NativeTerminalDtoSchema, StartNativeTerminalRequestSchema } from '@crewstation/contracts';
import { forbidden, PlatformError } from '@crewstation/kernel';
import { nativeFixture } from './nativeTerminalFixture';
import { workspaceActor as actor, workspaceTask as taskId } from './workspaceFixture';

test('逐个启动无需任务文字，重复请求查回原 CLI；另一用户同一请求 ID 不混用', async () => {
  const f = nativeFixture();
  const input = f.input();
  const first = NativeTerminalDtoSchema.parse(await f.api.startNativeTerminal(actor, taskId, input));
  const second = await f.api.startNativeTerminal(actor, taskId, input);
  expect(second.agentId).toBe(first.agentId);
  expect(f.calls.filter((c) => c.type === 'startAgentTerminal')).toHaveLength(1);
  expect(first).not.toHaveProperty('model');
  expect(first).not.toHaveProperty('driver');
  expect(f.calls.find((c) => c.type === 'startAgentTerminal')).toMatchObject({ compute: 'balanced', permission: 'edit', driver: 'claude-code', model: 'anthropic/model' });
  await expect(f.api.startNativeTerminal(actor, taskId, { ...input, permission: 'full' })).rejects.toMatchObject({ kind: 'conflict' });
  const another = { ...actor, userId: 'usr_1123456789abcdef0123456789abcdef' as UserId };
  expect((await f.api.startNativeTerminal(another, taskId, input)).agentId).not.toBe(first.agentId);
  expect((await f.api.listNativeTerminals(actor, taskId)).items).toHaveLength(2);
});

test('请求已执行但回包丢失只标未确认，查询及原 ID 重试不创建重复进程', async () => {
  const f = nativeFixture();
  f.current.loseStartResult = true;
  const input = f.input();
  const uncertain = await f.api.startNativeTerminal(actor, taskId, input);
  expect(uncertain).toMatchObject({ lifecycle: 'unknown', connection: 'unknown' });
  const list = await f.api.listNativeTerminals(actor, taskId);
  expect(list.items[0]).toMatchObject({ agentId: uncertain.agentId, lifecycle: 'running', connection: 'connected' });
  expect((await f.api.startNativeTerminal(actor, taskId, input)).agentId).toBe(uncertain.agentId);
  expect(f.calls.filter((c) => c.type === 'startAgentTerminal')).toHaveLength(1);
});

test('断线不冒称运行或完成；容器更换明确不可恢复，不自动重启；已结束在离线仍保留结束事实', async () => {
  const f = nativeFixture();
  const input = f.input();
  await f.api.startNativeTerminal(actor, taskId, input);
  f.state.connected = false;
  expect((await f.api.listNativeTerminals(actor, taskId)).items[0]?.lifecycle).toBe('unknown');
  f.state.connected = true;
  f.current.offline = true;
  expect((await f.api.listNativeTerminals(actor, taskId)).connection).toBe('unknown');
  f.current.offline = false;
  f.current.runnerId = crypto.randomUUID();
  f.current.terminals = [];
  expect((await f.api.listNativeTerminals(actor, taskId)).items[0]).toMatchObject({ lifecycle: 'ended', reason: 'runner-restarted' });
  expect((await f.api.startNativeTerminal(actor, taskId, input)).lifecycle).toBe('ended');
  expect(f.calls.filter((c) => c.type === 'startAgentTerminal')).toHaveLength(1);
  f.state.connected = false;
  expect((await f.api.listNativeTerminals(actor, taskId)).items[0]?.lifecycle).toBe('ended');
});

test('stop 只停止目标，重复 stop 不重新发结束命令；无 develop 权限不发指令', async () => {
  const f = nativeFixture();
  const one = await f.api.startNativeTerminal(actor, taskId, f.input());
  const two = await f.api.startNativeTerminal(actor, taskId, f.input());
  await f.api.stopNativeTerminal(actor, taskId, one.agentId);
  await f.api.stopNativeTerminal(actor, taskId, one.agentId);
  const records = (await f.api.listNativeTerminals(actor, taskId)).items;
  expect(records.find((r) => r.agentId === one.agentId)?.lifecycle).toBe('ended');
  expect(records.find((r) => r.agentId === two.agentId)?.lifecycle).toBe('running');
  expect(f.calls.filter((c) => c.type === 'stopAgentTerminal')).toHaveLength(1);
  f.deps.authorizer.authorize = async (_a, _p, operation) => { if (operation === 'develop') throw forbidden(); };
  await expect(f.api.stopNativeTerminal(actor, taskId, two.agentId)).rejects.toMatchObject({ kind: 'forbidden' });
  await expect(f.api.startNativeTerminal(actor, taskId, f.input())).rejects.toMatchObject({ kind: 'forbidden' });
});

test('明确的启动拒绝落失败记录，其他窗口继续存在；演示档位不能冒充原生 CLI', async () => {
  const f = nativeFixture();
  const first = await f.api.startNativeTerminal(actor, taskId, f.input());
  const original = f.deps.runner.sendCommand;
  f.deps.runner.sendCommand = async (task, command) => {
    if (command.type === 'startAgentTerminal') throw new PlatformError('precondition', 'PTY unavailable', { code: 'pty_unavailable' });
    return original(task, command);
  };
  const input = f.input();
  expect(await f.api.startNativeTerminal(actor, taskId, input)).toMatchObject({ lifecycle: 'failed', reason: 'start-failed' });
  expect((await f.api.listNativeTerminals(actor, taskId)).items.find((r) => r.agentId === first.agentId)?.lifecycle).toBe('running');
  expect((await f.api.startNativeTerminal(actor, taskId, input)).lifecycle).toBe('failed');
  f.current.driver = 'stub';
  await expect(f.api.startNativeTerminal(actor, taskId, f.input())).rejects.toMatchObject({ kind: 'precondition' });
});

test('租户输入只接受档位与会话选项，任意驱动参数和不合理窗口尺寸都拒绝', () => {
  const f = nativeFixture();
  const input = f.input();
  expect(StartNativeTerminalRequestSchema.safeParse(input).success).toBe(true);
  for (const extra of [{ driver: 'opencode' }, { model: 'mine' }, { flags: ['--continue'] }, { cols: 0 }, { rows: 5000 }, { prompt: 'requires text' }]) {
    expect(StartNativeTerminalRequestSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  }
});
