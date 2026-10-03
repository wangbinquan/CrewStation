import { expect, test } from 'bun:test';
import type { RunnerHello } from '@crewstation/contracts';
import { TASKRUNNER_PROTOCOL_VERSION, TaskIdSchema } from '@crewstation/contracts';
import { fixedClock, jsonHash, noopLogger } from '@crewstation/kernel';
import type { SessionConnectionBirth } from '../ports/projectDeletion';
import type { SessionUseCaseDeps } from './dependencies';
import { runnerHub } from './runnerHub';
import { commandDispatch } from './commandDispatch';

function fixture() {
  const taskId = TaskIdSchema.parse('01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd751'), born: SessionConnectionBirth[] = [], exited: string[] = [], frames: string[] = [], closed: string[] = [];
  let failExit = false, failBirth = false;
  const deps: SessionUseCaseDeps = {
    clock: fixedClock('2026-10-03T00:00:00Z'), logger: noopLogger,
    settings: { selfAddress: 'http://session', commandTimeoutMs: 1000, runnerStaleMs: 1000, replayLimit: 100 },
    events: { append: async () => {}, maxSeq: async () => 0, listSince: async () => [], summarize: async () => [] },
    registry: { claim: async () => { throw new Error('protected birth must claim atomically'); }, release: async () => {}, heartbeat: async () => {}, lookup: async () => undefined },
    runnerAuth: { verifyRunnerToken: async () => ({ ok: true, projectId: 'project' }) },
    taskAccess: { canOpenStream: async () => true, onRunnerConnected: async () => true, onRunnerDisconnected: async () => {} }, forwarder: { forward: async () => ({}) },
    connectionHistory: { open: async (_id, work) => work(), check: async () => {}, birth: async (input) => {
      if (failBirth) throw new Error('birth failed'); const original = { ...input, identity: jsonHash(input) }; born.push(original); return original;
    }, exit: async (original, key) => { expect(jsonHash(key)).toBe(original.exitKeyHash); if (failExit) throw new Error('exit unavailable'); exited.push(original.id); } },
  };
  const hub = runnerHub(deps), hello: RunnerHello = { type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId, runnerToken: 'private token', workdir: '/private', capabilities: { protocols: ['terminal'], pty: true, preview: false } };
  const connect = async () => { const result = await hub.onHello(structuredClone(hello), { send: (frame) => frames.push(frame), close: (_code, reason) => closed.push(reason) }); if (!result.ok) throw new Error(result.message); return result.connection; };
  return { deps, hub, born, exited, frames, closed, connect, failExit: (value: boolean) => { failExit = value; }, failBirth: (value: boolean) => { failBirth = value; } };
}
test('a failed durable exit can retry the same original connection; a changed birth cannot close it', async () => {
  const f = fixture(), connection = await f.connect(), original = f.born[0]!;
  expect(await f.hub.drain({ ...original, identity: jsonHash('replacement') })).toBe(false); expect(connection.closed).toBe(false);
  f.failExit(true); await expect(f.hub.drain(original)).rejects.toThrow('exit unavailable');
  expect(connection.closed).toBe(true); expect(connection.hello.runnerToken).toBe(''); expect(f.exited).toEqual([]);
  f.failExit(false); expect(await f.hub.drain(original)).toBe(true); expect(f.exited).toEqual([original.id]);
});
test('drain waits for legacy command preparation and original event persistence; concurrent drain calls share the same cleanup', async () => {
  const f = fixture(), connection = await f.connect(), event = Promise.withResolvers<void>(), eventEntered = Promise.withResolvers<void>(), command = Promise.withResolvers<void>();
  f.deps.events.append = async () => { eventEntered.resolve(); await event.promise; };
  connection.legacy = { incoming: async (raw) => raw, outgoing: async () => { await command.promise; return { id: 'late-command' }; } };
  const dispatch = commandDispatch(f.deps, f.hub), pending = dispatch.sendLocalOnly(connection.hello.taskId, { id: 'late-command', type: 'previewStatus' }).catch((error) => error.kind);
  const processing = f.hub.onMessage(connection, { type: 'event', seq: 1, at: '2026-10-03T00:00:00Z', event: { kind: 'previewState', state: 'ready', port: 3000 } });
  await eventEntered.promise;
  const first = f.hub.drain(f.born[0]!), second = f.hub.drain(f.born[0]!);
  expect(f.exited).toEqual([]); event.resolve(); await processing; expect(f.exited).toEqual([]);
  command.resolve(); expect(await first).toBe(true); expect(await second).toBe(true); expect(await pending).toBe('precondition');
  expect(f.frames.map((frame) => JSON.parse(frame).id)).not.toContain('late-command'); expect(f.exited).toHaveLength(1);
});
test('reconnect persists the old private exit; a failed birth closes and removes the unwelcomed connection', async () => {
  const f = fixture(), original = await f.connect(); await f.connect(); expect(f.exited).toEqual([f.born[0]!.id]); expect(original.closed).toBe(true);
  f.failBirth(true); await expect(f.connect()).rejects.toThrow('birth failed'); expect(f.hub.connections.size).toBe(0);
  expect(f.frames.map((frame) => JSON.parse(frame).type)).toEqual(['welcome', 'welcome']); expect(f.closed).toHaveLength(3);
  f.failBirth(false); expect((await f.connect()).closed).toBe(false);
});
test('deletion joins an already running disconnect callback and cannot record exit before that callback finishes', async () => {
  const f = fixture(), connection = await f.connect(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.deps.taskAccess.onRunnerDisconnected = async (_id, token) => { expect(token).toBe('private token'); entered.resolve(); await release.promise; };
  const disconnect = f.hub.onClose(connection); await entered.promise;
  const deletion = f.hub.drain(f.born[0]!); expect(f.exited).toEqual([]);
  release.resolve(); await disconnect; expect(await deletion).toBe(true); expect(f.exited).toHaveLength(1);
});
test('service shutdown closes existing connections, waits for a pending handshake and rejects later handshakes', async () => {
  const f = fixture(), original = await f.connect(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.deps.taskAccess.onRunnerConnected = async () => { entered.resolve(); await release.promise; return true; };
  const opening = f.connect().catch((error) => error.message); await entered.promise;
  const stopping = f.hub.shutdown(); release.resolve(); await stopping;
  expect(await opening).toContain('服务正在停止'); expect(f.hub.connections.size).toBe(0); expect(original.closed).toBe(true);
  expect(f.exited).toHaveLength(2); await expect(f.connect()).rejects.toThrow('服务正在停止');
});

test('concurrent hello for one task cannot close a connection before its durable original birth has finished', async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const birth = f.deps.connectionHistory!.birth; let calls = 0;
  f.deps.connectionHistory!.birth = async (input) => {
    if (++calls === 1) { entered.resolve(); await release.promise; }
    return birth(input);
  };
  const first = f.connect(); await entered.promise;
  const second = f.connect(); await Bun.sleep(20);
  release.resolve(); const [original, replacement] = await Promise.all([first, second]);
  expect(original.closed).toBe(true); expect(replacement.closed).toBe(false);
  expect(f.hub.connections.get(original.hello.taskId)).toBe(replacement);
  expect(f.born).toHaveLength(2); expect(f.exited).toEqual([f.born[0]!.id]);
  expect(await f.hub.drain(f.born[1]!)).toBe(true); expect(f.exited).toHaveLength(2);
});

test('a pending birth for one task leaves a different task free to connect', async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), birth = f.deps.connectionHistory!.birth;
  let first = true;
  f.deps.connectionHistory!.birth = async (input) => { if (first) { first = false; entered.resolve(); await release.promise; } return birth(input); };
  const opening = f.connect(); await entered.promise;
  try {
    const other = await f.hub.onHello({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId: TaskIdSchema.parse(Bun.randomUUIDv7()), runnerToken: 'other token', workdir: '/other',
      capabilities: { protocols: ['terminal'], pty: true, preview: false } }, { send: () => {} });
    expect(other.ok).toBe(true); expect(f.born).toHaveLength(1);
  } finally { release.resolve(); await opening; await f.hub.shutdown(); }
  expect(f.exited).toHaveLength(2);
});
