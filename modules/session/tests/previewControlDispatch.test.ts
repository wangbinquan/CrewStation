import { expect, test } from 'bun:test';
import type { RunnerCommand, RunnerHello, TaskId } from '@crewstation/contracts';
import { TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import { commandDispatch } from '../application/commandDispatch';
import { RunnerConnection } from '../domain/runnerConnection';

const taskId = '01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd751' as TaskId;
const hello: RunnerHello = { type: 'hello', taskId, protocolVersion: TASKRUNNER_PROTOCOL_VERSION, runnerToken: 'token', workdir: '/work', capabilities: { protocols: ['claude-code'], pty: true, preview: true } };

/** RFC-016 的三条新命令；`previewStatus`／`restartPreview` 不在此列，存量会话必须照常可用。 */
const GATED: RunnerCommand[] = [
  { id: 'p1', type: 'startPreview' },
  { id: 'p2', type: 'stopPreview' },
  { id: 'p3', type: 'previewLogs', limit: 50 },
];

function fixture(capable: boolean) {
  const sent: RunnerCommand[] = [];
  const connection = new RunnerConnection({ ...hello, capabilities: { ...hello.capabilities, ...(capable ? { previewControl: 1 as const } : {}) } }, { send: (frame) => { sent.push(JSON.parse(frame)); } }, 0, 1000, 0);
  const connections = new Map([[taskId, connection]]);
  const deps = {
    registry: { lookup: async () => undefined, claim: async () => {}, release: async () => {}, heartbeat: async () => {} },
    forwarder: { forward: async () => { throw new Error('unexpected forward'); } },
    clock: fixedClock('2026-09-21T00:00:00.000Z'),
    settings: { selfAddress: 'local', commandTimeoutMs: 1000, runnerStaleMs: 60_000, replayLimit: 100 },
  };
  return { deps, connection, sent, dispatch: commandDispatch(deps, { connections }) };
}

test('旧镜像的容器：三条新命令在写 socket 前被拒，状态与重启仍然可用', async () => {
  const f = fixture(false);
  for (const command of GATED) {
    await expect(f.dispatch.sendCommand(taskId, command)).rejects.toMatchObject({ kind: 'precondition', details: { code: 'preview_control_unavailable' } });
  }
  // 拒绝必须发生在写入之前，否则旧 Runner 会收到看不懂的帧。
  expect(f.sent).toEqual([]);
  expect(f.connection.pending.size).toBe(0);

  for (const [index, command] of ([{ id: 'v1', type: 'previewStatus' }, { id: 'v2', type: 'restartPreview' }] as RunnerCommand[]).entries()) {
    const pending = f.dispatch.sendCommand(taskId, command);
    f.connection.pending.settle(command.id, { ok: true, payload: { ok: index } });
    expect(await pending).toEqual({ ok: index });
  }
  expect(f.sent.map((item) => item.type)).toEqual(['previewStatus', 'restartPreview']);
});

test('宣告 previewControl 的容器：三条新命令正常下发', async () => {
  const f = fixture(true);
  for (const command of GATED) {
    const pending = f.dispatch.sendCommand(taskId, command);
    f.connection.pending.settle(command.id, { ok: true, payload: {} });
    expect(await pending).toEqual({});
  }
  expect(f.sent.map((item) => item.type)).toEqual(['startPreview', 'stopPreview', 'previewLogs']);
});

test('跨副本时由持有连接的副本协商，转发端不自行放行', async () => {
  const old = fixture(false);
  const forwarded = commandDispatch(
    { ...old.deps, registry: { ...old.deps.registry, lookup: async () => ({ replica: 'owner', lastSeenAt: old.deps.clock.now() }) }, forwarder: { forward: async (_replica, id, input) => old.dispatch.sendLocalOnly(id, input) } },
    { connections: new Map() },
  );
  await expect(forwarded.sendCommand(taskId, GATED[0]!)).rejects.toMatchObject({ details: { code: 'preview_control_unavailable' } });
  expect(old.sent).toEqual([]);
});
