import { expect, test } from 'bun:test';
import { TASKRUNNER_PROTOCOL_VERSION, TaskIdSchema } from '@crewstation/contracts';
import { fixedClock, noopLogger } from '@crewstation/kernel';
import { runnerHub } from '../application/runnerHub';
import type { SessionUseCaseDeps } from '../application/dependencies';

test('旧握手通过初检但已失效时，不接管连接、不清空当前命令或发出 welcome', async () => {
  const taskId = TaskIdSchema.parse(`tsk_${'a'.repeat(32)}`), callbacks: string[] = [], frames: string[] = [];
  let accepted = 'original';
  const deps: SessionUseCaseDeps = {
    clock: fixedClock('2026-09-15T10:00:00Z'), logger: noopLogger,
    settings: { commandTimeoutMs: 1000, runnerStaleMs: 30000, replayLimit: 100, selfAddress: 'http://session' },
    events: { append: async () => {}, maxSeq: async () => 0, listSince: async () => [] },
    registry: { claim: async () => { callbacks.push('claim'); }, release: async () => {}, heartbeat: async () => {}, lookup: async () => undefined },
    runnerAuth: { verifyRunnerToken: async () => ({ ok: true, projectId: 'project' }) },
    taskAccess: { canOpenStream: async () => true, onRunnerConnected: async (_id, token) => token === accepted,
      onRunnerDisconnected: async (_id, token) => { callbacks.push(`closed:${token}`); }, onRunnerReady: () => { expect(hub.connections.has(taskId)).toBe(true); expect(JSON.parse(frames.at(-1)!).type).toBe('welcome'); callbacks.push('ready'); } },
    forwarder: { forward: async () => ({}) },
  };
  const hub = runnerHub(deps);
  const connect = (token: string) => hub.onHello({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId, runnerToken: token, workdir: '/work', capabilities: { protocols: ['claude-code', 'opencode', 'terminal'], pty: true, preview: true } }, { send: (frame) => frames.push(frame) });
  const first = await connect('original'); if (!first.ok) throw new Error(first.message);
  first.connection.pending.add({ id: 'pending', type: 'listFiles', sentAt: 0, resolve: () => {}, reject: () => callbacks.push('rejected') });
  accepted = 'new-generation';
  expect(await connect('original')).toMatchObject({ ok: false, code: 'unauthorized' });
  expect(hub.connections.get(taskId)).toBe(first.connection); expect(first.connection.pending.size).toBe(1);
  expect(callbacks).toEqual(['claim', 'ready']); expect(frames).toHaveLength(1);
  const second = await connect('new-generation'); if (!second.ok) throw new Error(second.message);
  expect(first.connection.pending.size).toBe(0);
  await hub.onClose(first.connection); expect(callbacks).not.toContain('closed:original');
  await hub.onClose(second.connection); expect(callbacks.at(-1)).toBe('closed:new-generation');
});
