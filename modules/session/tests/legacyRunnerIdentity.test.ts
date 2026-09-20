import { describe, expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { ResourceIdSchema, StartAgentCommandSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId, noopLogger, systemClock } from '@crewstation/kernel';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { legacyRunnerIdentity } from '../adapters/persistence/legacyRunnerIdentity';
import { drizzleConnectionRegistry, drizzleRunnerEventStore } from '../adapters/persistence/drizzleRepositories';
import { runnerHub } from '../application/runnerHub';
import { commandDispatch } from '../application/commandDispatch';
import type { SessionUseCaseDeps } from '../application/dependencies';
import { sessionMigrations } from '../wiring';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('protocol 2 UUID compatibility', () => {
  test('authenticated old Runner resumes its original sequence, preserves source events and maps commands back to the same process', async () => {
    const tdb = await createTestDatabase([sessionMigrations]);
    try {
      const directory = resourceIdentityDirectory(tdb.db, () => [sessionMigrations]);
      const taskId = newResourceId() as TaskId, profileId = newResourceId(), oldTask = 'tsk_0123456789abcdef0123456789abcdef';
      await directory.bind('session', 'task', [oldTask], taskId);
      await directory.bind('session', 'compute-profile', ['balanced'], profileId);
      const frames: Record<string, unknown>[] = [], connected: string[] = [];
      let resolveCommand: ((value: Record<string, unknown>) => void) | undefined;
      const wireCommand = new Promise<Record<string, unknown>>((resolve) => { resolveCommand = resolve; });
      const deps: SessionUseCaseDeps = {
        events: drizzleRunnerEventStore(tdb.db), registry: drizzleConnectionRegistry(tdb.db),
        legacyRunners: legacyRunnerIdentity(directory), logger: noopLogger, clock: systemClock,
        runnerAuth: { verifyRunnerToken: async (id, token) => id === taskId && token === 'unchanged' ? { ok: true, projectId: newResourceId() } : { ok: false, reason: 'invalid' } },
        taskAccess: { canOpenStream: async () => true, onRunnerConnected: async (id) => { connected.push(id); }, onRunnerDisconnected: async () => undefined },
        forwarder: { forward: async () => { throw new Error('unexpected forward'); } },
        settings: { selfAddress: 'local', commandTimeoutMs: 2000, runnerStaleMs: 30000, replayLimit: 100 },
      };
      const hub = runnerHub(deps), dispatch = commandDispatch(deps, hub);
      const hello = { type: 'hello', protocolVersion: 2, taskId: oldTask, runnerToken: 'unchanged', workdir: '/work', capabilities: { protocols: ['terminal'], pty: true, preview: true } };
      const socket = { send: (text: string) => { const frame = JSON.parse(text); frames.push(frame); if (frame.type === 'stopAgentTerminal') resolveCommand?.(frame); } };
      expect(await hub.onHello({ ...hello, runnerToken: 'wrong' }, socket)).toMatchObject({ ok: false, code: 'unauthorized' });
      expect(connected).toEqual([]);
      const open = await hub.onHello(hello, socket); if (!open.ok) throw new Error(open.message);
      expect(frames[0]).toMatchObject({ type: 'welcome', protocolVersion: 2, resumeFromSeq: 0 });
      expect(connected).toEqual([taskId]);
      expect(await deps.legacyRunners!.normalizeTask!({ ...hello, protocolVersion: 1 })).toMatchObject({ taskId, protocolVersion: 1 });
      const stepId = newResourceId(); await directory.bind('session', 'compute-step', ['balanced', 'file-old'], stepId);
      const boundary = (await deps.legacyRunners!.hello(hello))!;
      const command = StartAgentCommandSchema.parse({ id: newResourceId(), type: 'startAgent', agentId: newResourceId(), compute: profileId, profileRevision: 1, permission: 'edit', mode: 'oneshot', processAttemptId: 'attempt:1', launch: { protocol: 'claude-code', binaryPath: '/cli' },
        beforeStart: { profile: profileId, revision: 1, contentHash: 'frozen', steps: [{ kind: 'file', stepId, name: 'config', pathTemplate: '{{agent.home}}/settings.json', contentTemplate: '{}', format: 'json' }], vars: {}, secrets: {}, configFile: { kind: 'claude-settings', pathTemplate: `{{steps.${stepId}.path}}` } } });
      const wire = await boundary.bridge.outgoing(command) as typeof command;
      expect(wire.beforeStart.steps[0]!.stepId).toBe('file-old');
      expect(wire.beforeStart.configFile).toMatchObject({ pathTemplate: '{{steps.file-old.path}}' });
      expect(command.beforeStart.steps[0]!.stepId).toBe(stepId);
      const freshProfile = newResourceId();
      const fresh = await boundary.bridge.outgoing({ ...command, compute: freshProfile, beforeStart: { ...command.beforeStart, profile: freshProfile } }) as typeof command;
      expect(fresh.beforeStart.profile).toMatch(/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/);
      expect(fresh.compute).toBe(fresh.beforeStart.profile);
      expect(await directory.resolve('compute-profile', [fresh.beforeStart.profile])).toBe(freshProfile);
      const at = new Date().toISOString(), oldRunner = crypto.randomUUID();
      const original = { kind: 'nativeTerminal', terminal: { agentId: 'agt-old', terminalId: 'pty-old', runnerId: oldRunner, compute: 'balanced', permission: 'full', cols: 100, rows: 30, revision: 0, lifecycle: 'running', startedAt: at, nativeSessionId: 'balanced', error: 'agt-old is protocol text' } };
      await Promise.all([
        hub.onMessage(open.connection, { type: 'event', seq: 1, at, event: original }),
        hub.onMessage(open.connection, { type: 'event', seq: 2, at, event: { kind: 'agent', event: { agentId: 'agt-old', seq: 0, at, type: 'text', text: 'agt-old balanced', raw: { agentId: 'do-not-rewrite' } } } }),
      ]);
      const events = await deps.events.listSince(taskId, 0, { limit: 10 });
      expect(events.map((event) => event.seq)).toEqual([1, 2]);
      const terminal = events[0]!.event; if (terminal.kind !== 'nativeTerminal') throw new Error('missing terminal');
      expect([terminal.terminal.agentId, terminal.terminal.terminalId, terminal.terminal.runnerId].every((id) => ResourceIdSchema.safeParse(id).success)).toBe(true);
      expect(terminal.terminal).toMatchObject({ compute: profileId, nativeSessionId: 'balanced', error: 'agt-old is protocol text' });
      expect(events[1]!.event).toMatchObject({ event: { agentId: terminal.terminal.agentId, text: 'agt-old balanced', raw: { agentId: 'do-not-rewrite' } } });
      expect(await tdb.db.execute('SELECT legacy_event FROM session.runner_events WHERE seq = 1')).toEqual([{ legacy_event: original }]);
      expect((await tdb.db.execute('SELECT identity_provenance FROM session.runner_events WHERE seq = 1'))[0]).toEqual({ identity_provenance: { originalHash: jsonHash(original), normalizedHash: jsonHash(events[0]!.event), protocol: 2 } });
      const pending = dispatch.sendCommand(taskId, { id: 'stop-original', type: 'stopAgentTerminal', agentId: terminal.terminal.agentId, runnerId: terminal.terminal.runnerId });
      expect(await wireCommand).toMatchObject({ agentId: 'agt-old', runnerId: oldRunner });
      await hub.onMessage(open.connection, { type: 'result', id: 'stop-original', payload: {} }); await pending;
      await hub.onClose(open.connection);
      const resumed = await hub.onHello(hello, socket); if (!resumed.ok) throw new Error(resumed.message);
      expect(frames.at(-1)).toMatchObject({ type: 'welcome', resumeFromSeq: 2 });
      await hub.onMessage(resumed.connection, { type: 'event', seq: 2, at, event: original });
      expect(await deps.events.maxSeq(taskId)).toBe(2);
    } finally { await tdb.drop(); }
  });
});
