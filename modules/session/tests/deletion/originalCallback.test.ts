import { expect, test } from 'bun:test';
import { TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import type { TaskId } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { runnerLifetime } from '../../application/runnerLifetime';
import { RunnerConnection } from '../../domain/runnerConnection';
import { SessionBirthSchema } from '../../domain/projectDeletion';

function fixture() {
  const taskId = '01a0bf5d-8f4b-7001-8458-107366e7de39' as TaskId;
  const connections = new Map<TaskId, RunnerConnection>(), exits: string[] = [], releases: string[] = [];
  let born: Parameters<typeof SessionBirthSchema.parse>[0];
  const lifetime = runnerLifetime({ settings: { selfAddress: 'http://original.invalid', commandTimeoutMs: 1000, runnerStaleMs: 30000, replayLimit: 100 },
    registry: { lookup: async () => undefined, heartbeat: async () => {}, claim: async () => {}, release: async (_id, _replica, consumer) => { if (consumer) releases.push(consumer); } },
    taskAccess: { canOpenStream: async () => true, onRunnerConnected: async () => {}, onRunnerDisconnected: async () => {} },
    connectionHistory: { check: async () => {}, open: async (_id, action) => action(), birth: async (input) => { born = { ...input, identity: jsonHash(input) }; return SessionBirthSchema.parse(born); },
      exit: async (birth, key) => { expect(jsonHash(key)).toBe(birth.exitKeyHash); exits.push(birth.id); } },
  }, connections, new Map());
  const create = () => new RunnerConnection({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId, runnerToken: 'fixture', workdir: '/work',
    capabilities: { protocols: [], pty: false, preview: false } }, { send() {}, close() {} }, 0, 1000, Date.now());
  const connect = async () => { const connection = create(); await lifetime.register(connection, new Date()); connections.set(taskId, connection); return { connection, birth: SessionBirthSchema.parse(born) }; };
  return { taskId, lifetime, connections, exits, releases, connect };
}

test('the whole original cleanup callback delays private finally after close, even when its wire pending set is empty', async () => {
  const f = fixture(), { connection, birth } = await f.connect(), entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  const callback = f.lifetime.withOriginal(birth, async (actual, key) => {
    expect(actual).toBe(connection); expect(jsonHash(key)).toBe(birth.exitKeyHash); entered.resolve();
    await finish.promise; throw new Error('late original persistence failure');
  });
  const rejected = callback.then(() => 'unexpected success', (error: Error) => error.message);
  await entered.promise;
  const close = f.lifetime.drain(birth);
  expect(connection.closed).toBe(true); expect(f.exits).toEqual([]); expect(f.releases).toEqual([]);
  await expect(f.lifetime.withOriginal(birth, async () => undefined)).rejects.toThrow('私有许可');
  finish.resolve(); expect(await rejected).toBe('late original persistence failure'); expect(await close).toBe(true);
  expect(f.exits).toEqual([birth.id]); expect(f.releases).toEqual([birth.id]);
});

test('captured identity and replica cannot be substituted with the latest connection or a public digest', async () => {
  const f = fixture(), first = await f.connect();
  await expect(f.lifetime.withOriginal({ ...first.birth, identity: jsonHash('replacement') }, async () => undefined)).rejects.toThrow('私有许可');
  await expect(f.lifetime.withOriginal({ ...first.birth, replica: 'http://other.invalid' }, async () => undefined)).rejects.toThrow('私有许可');
  await f.lifetime.finish(first.connection, 'original gone');
  const next = await f.connect();
  await expect(f.lifetime.withOriginal(first.birth, async () => undefined)).rejects.toThrow('私有许可');
  expect(await f.lifetime.withOriginal(next.birth, async () => 'original')).toBe('original');
  await f.lifetime.drain(next.birth); expect(f.exits).toHaveLength(2);
});

test('a rejected outer deadline cannot release another already issued original callback', async () => {
  const f = fixture(), { birth } = await f.connect(), release = Promise.withResolvers<void>();
  let issued: Promise<void> | undefined;
  const result = f.lifetime.withOriginal(birth, async (connection) => {
    issued = connection.command(async () => { await release.promise; });
    throw new Error('outer admission connection lost');
  }).then(() => 'unexpected success', (error: Error) => error.message);
  expect(await result).toBe('outer admission connection lost');
  const closed = f.lifetime.drain(birth);
  expect(f.exits).toEqual([]); expect(f.releases).toEqual([]);
  release.resolve(); await issued; expect(await closed).toBe(true); expect(f.exits).toEqual([birth.id]);
});
