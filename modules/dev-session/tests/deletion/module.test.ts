import { describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleAgentStarts } from '../../adapters/persistence/drizzleAgentStarts';
import { drizzleNativeTerminals } from '../../adapters/persistence/drizzleNativeTerminals';
import { PREVIEW_PEEK_MS } from '../../application/sessionLifecycle';
import { workspaceActor } from '../workspaceFixture';
import { seedDevelopmentContent } from './contentFixture';
import { developmentModuleFixture } from './moduleFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('development deletion factory integration (actual PG; controlled runtime ports)', () => {
  test('a bounded session response keeps the original command alive; seal and worker drain wait for its private finally', async () => {
    const f = await developmentModuleFixture(), entered = Promise.withResolvers<void>(), command = Promise.withResolvers<unknown>();
    f.dependencies.runner.sendCommand = async () => { entered.resolve(); return command.promise; };
    const module = f.create();
    let seal: Promise<unknown> | undefined, stopped = false, sealed = false;
    try {
      const response = module.api.getSession(workspaceActor, f.project);
      await entered.promise;
      expect(await response).toMatchObject({ taskId: f.workspace, preview: 'stopped' });
      const confirmed = await module.api.deletionOwner!.inspect(f.target);
      expect(confirmed.complete).toBe(true);
      seal = module.api.deletionOwner!.run(f.context(confirmed)).then((result) => { sealed = true; return result; });
      await f.waitSeal();
      const stop = Promise.all(module.workers.map((worker) => worker.stop())).then(() => { stopped = true; });
      expect(sealed || stopped).toBe(false);
      const pending = (await f.work.history(f.project)).filter((row) => !row.exited);
      expect(pending.some((row) => row.kind === 'project-api')).toBe(true);
      expect(pending.some((row) => row.kind === 'effect')).toBe(true);
      command.resolve({ state: 'ready', port: 3000, restarts: 0 });
      expect(await seal).toMatchObject({ kind: 'done' }); await stop;
      expect((await f.work.history(f.project)).every((row) => row.exited)).toBe(true);
      const effects = f.effects();
      await expect(module.api.touch(f.workspace)).rejects.toThrow('封闭');
      await expect(module.api.listBranches(workspaceActor, f.project)).rejects.toThrow('封闭');
      expect(f.effects()).toBe(effects);
      expect((await module.api.deletionOwner!.run(f.context(confirmed, 'stop'))).kind).toBe('done');
    } finally { command.resolve({}); await seal?.catch(() => undefined); await Promise.all(module.workers.map((worker) => worker.stop())); await f.drop(); }
  }, PREVIEW_PEEK_MS + 8000);

  test('sealed project rows are excluded in scheduler SQL while another project continues; direct dispatch cannot bypass admission', async () => {
    const f = await developmentModuleFixture(), module = f.create();
    try {
      const own = await seedDevelopmentContent(f), otherAgent = await f.agent(f.otherWorkspace), otherCli = await f.native(f.otherWorkspace);
      await f.database.db.execute(sql`UPDATE dev_session.native_terminal_starts SET execution=jsonb_set(execution,'{finalized}','false')`);
      const confirmed = await module.api.deletionOwner!.inspect(f.target); expect(confirmed.complete).toBe(true);
      expect((await module.api.deletionOwner!.run(f.context(confirmed))).kind).toBe('done');
      expect((await drizzleAgentStarts(f.database.db, true).listUnfinalized(undefined, 32)).map((row) => row.agentId)).toEqual([otherAgent.agentId]);
      expect((await drizzleNativeTerminals(f.database.db, true).listExecutions(undefined, 32)).map((row) => row.record.agentId)).toEqual([otherCli.agentId]);
      const effects = f.effects(); await module.api.dispatchPendingNativeExecution(own.headless.id);
      await module.api.dispatchPendingNativeExecution(own.cli.id! as typeof f.workspace);
      expect(f.effects()).toBe(effects);
      expect((await f.work.history(f.project)).filter((row) => row.kind.endsWith('dispatch'))).toEqual([]);
    } finally { await Promise.all(module.workers.map((worker) => worker.stop())); await f.drop(); }
  });

  test('the actual Agent factory records API, persisted admission and background dispatch lifetimes before effects', async () => {
    const f = await developmentModuleFixture(), module = f.create();
    try {
      const agent = await module.api.startAgent(workspaceActor, f.workspace, { prompt: 'original-private-prompt' });
      await Promise.all(module.workers.map((worker) => worker.stop()));
      expect(agent.execution?.state).toBe('queued');
      const rows = await f.work.history(f.project);
      expect(rows.some((row) => row.kind === 'task-api')).toBe(true);
      // An immediate background signal may be rejected after its caller closes; the original worker replay must be admitted independently.
      await module.api.dispatchPendingNativeExecution(agent.execution!.taskId);
      const replayed = await f.work.history(f.project);
      expect(replayed.some((row) => row.kind === 'agent-dispatch')).toBe(true);
      expect(replayed.every((row) => row.exited)).toBe(true);
      expect(JSON.stringify(replayed)).not.toContain('original-private-prompt');
      expect(f.effects()).toBeGreaterThan(0);
      f.unavailable.add('task:' + f.workspace); const effects = f.effects();
      await expect(module.api.touch(f.workspace)).rejects.toThrow('offline'); expect(f.effects()).toBe(effects);
    } finally { await Promise.all(module.workers.map((worker) => worker.stop())); await f.drop(); }
  });
});
