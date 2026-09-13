import { expect, test } from 'bun:test';
import type { RunnerCommand, RunnerHello, TaskId } from '@crewstation/contracts';
import { API_INVOCATION_TIMEOUT_MS } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import { commandDispatch } from '../application/commandDispatch';
import { RunnerConnection } from '../domain/runnerConnection';
import { commandTimeout } from '../domain/commandTimeout';
import { fetchForwarder } from '../adapters/http/fetchForwarder';

const taskId = 'tsk_0123456789abcdef0123456789abcdef' as TaskId;
const command: RunnerCommand = { id: 'invoke', type: 'invokeApi', proxy: 'crm', method: 'GET', path: '/items', query: {}, headers: {} };
const hello: RunnerHello = { type: 'hello', taskId, protocolVersion: 1, runnerToken: 'token', workdir: '/work', capabilities: { drivers: ['stub'], pty: true, preview: false } };

function fixture(capable: boolean) {
  const sent: RunnerCommand[] = [];
  const connection = new RunnerConnection({ ...hello, capabilities: { ...hello.capabilities, ...(capable ? { apiInvocations: 1 as const } : {}) } }, { send: (frame) => { sent.push(JSON.parse(frame)); } }, 0, 1000, 0);
  const connections = new Map([[taskId, connection]]);
  const deps = {
    registry: { lookup: async () => undefined, claim: async () => {}, release: async () => {}, heartbeat: async () => {} },
    forwarder: { forward: async () => { throw new Error('unexpected forward'); } },
    clock: fixedClock('2026-09-13T00:00:00.000Z'),
    settings: { selfAddress: 'local', commandTimeoutMs: 1000, runnerStaleMs: 60_000, replayLimit: 100 },
  };
  return { deps, connections, connection, sent, dispatch: commandDispatch(deps, { connections }) };
}

test('旧 Runner 拒绝新命令时 socket 和 pending 均未写入；CLI 普通命令继续可用', async () => {
  const f = fixture(false);
  await expect(f.dispatch.sendCommand(taskId, command)).rejects.toMatchObject({ details: { code: 'api_invocations_unavailable' } });
  await expect(f.dispatch.sendLocalOnly(taskId, command)).rejects.toMatchObject({ kind: 'precondition' });
  expect(f.sent).toEqual([]); expect(f.connection.pending.size).toBe(0);
  expect(await f.dispatch.connectionStatus(taskId)).toMatchObject({ connected: true, drivers: ['stub'] });
  const ordinary = f.dispatch.sendCommand(taskId, { id: 'list', type: 'listAgentTerminals' });
  expect(f.sent.map((item) => item.type)).toEqual(['listAgentTerminals']);
  f.connection.pending.settle('list', { ok: true, payload: { terminals: [] } });
  expect(await ordinary).toEqual({ terminals: [] });
});

test('新 Runner 获得有界传输预算；跨副本同样由持有连接的副本协商', async () => {
  const f = fixture(true);
  const pending = f.dispatch.sendCommand(taskId, command);
  expect(commandTimeout(command)).toEqual({ timeoutMs: API_INVOCATION_TIMEOUT_MS + 10_000 });
  expect(f.connection.pending.expire(f.deps.clock.now().getTime() + 1001)).toBe(0);
  f.connection.pending.settle(command.id, { ok: true, payload: { status: 200 } });
  expect(await pending).toEqual({ status: 200 });
  const old = fixture(false);
  const forwarded = commandDispatch({ ...f.deps, registry: { ...f.deps.registry, lookup: async () => ({ replica: 'owner', lastSeenAt: f.deps.clock.now() }) }, forwarder: { forward: async (_replica, id, input) => old.dispatch.sendLocalOnly(id, input) } }, { connections: new Map() });
  await expect(forwarded.sendCommand(taskId, command)).rejects.toMatchObject({ details: { code: 'api_invocations_unavailable' } });
  expect(old.sent).toEqual([]);
});

test('实际转发适配器保留旧容器拒绝码，同时禁用底层重发与重定向', async () => {
  const requests: Array<RequestInit | undefined> = [];
  const fetchImpl = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(init);
    return Response.json({ error: 'precondition', message: '当前开发容器不支持 API 试调', details: { code: 'api_invocations_unavailable' } }, { status: 412 });
  }, { preconnect: fetch.preconnect });
  await expect(fetchForwarder(fetchImpl).forward('http://owner', taskId, command)).rejects.toMatchObject({ kind: 'precondition', details: { code: 'api_invocations_unavailable' } });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ keepalive: false, redirect: 'error', signal: expect.any(AbortSignal) });
});
