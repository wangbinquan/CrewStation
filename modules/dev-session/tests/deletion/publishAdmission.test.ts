import { describe, expect, test } from 'bun:test';
import { NATIVE_REGISTRY_ADMISSION } from '@crewstation/contracts';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmissions } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentModuleFixture } from './moduleFixture';
import { workspaceActor, workspaceSha } from '../workspaceFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('development publication hands off original admission to Release', () => {
  for (const refused of [false, true]) test(`Release ${refused ? 'refusal' : 'acceptance'} follows the actual Development callback exit`, async () => {
    const f = await developmentModuleFixture(), db = f.database.db;
    const developmentKey = 'dev-session.project-admission:' + f.project;
    const releaseKeys = [NATIVE_REGISTRY_ADMISSION, 'release.project-admission:' + f.project, 'resources.project-admission:' + f.project];
    let pushed = false, published = false;
    const command = f.dependencies.runner.sendCommand, publish = f.dependencies.releases.publish;
    f.dependencies.runner.sendCommand = async (...args) => {
      assertSharedDatabaseAdmissionActive(db, developmentKey);
      if (args[1].type === 'exec') pushed = true;
      return command(...args);
    };
    f.dependencies.releases.publish = async (...args) => withSharedDatabaseAdmissions(db, releaseKeys, async () => {
      // The real first delivery hit "Cannot expand an active shared admission"
      // after Git push: Release must acquire its own complete lock set after Development exits.
      expect(pushed).toBe(true); published = true;
      expect(() => assertSharedDatabaseAdmissionActive(db, developmentKey)).toThrow('has exited');
      for (const key of releaseKeys) assertSharedDatabaseAdmissionActive(db, key);
      const callbacks = await f.work.history(f.project);
      expect(callbacks.some(row => row.kind === 'project-api')).toBe(true);
      expect(callbacks.every(row => row.exited)).toBe(true);
      const [locks] = await db.execute<{ count: number }>(sql`SELECT count(*)::integer AS count FROM pg_locks WHERE locktype='advisory' AND mode='ShareLock' AND granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`);
      expect(locks?.count).toBe(3);
      expect(args[2]).toEqual({ branch: 'main', version: 'v0.1.1', expectedCommitSha: workspaceSha });
      expect(args[3]).toEqual({ kind: 'session', taskId: f.workspace });
      if (refused) throw Error('Release project sealed');
      return publish(...args);
    });
    const module = f.create();
    try {
      const pending = module.api.publish(workspaceActor, f.project, { branch: 'main', version: 'v0.1.1', expectedTaskId: f.workspace, expectedCommitSha: workspaceSha });
      if (refused) await expect(pending).rejects.toThrow('Release project sealed');
      else expect(await pending).toMatchObject({ commitSha: workspaceSha, status: 'pending' });
      expect(published).toBe(true);
    } finally { await Promise.all(module.workers.map(worker => worker.stop())); await f.drop(); }
  });

  test('a sealed Development origin cannot push or reach the Release handoff', async () => {
    const f = await developmentModuleFixture(); let commands = 0, releases = 0;
    f.dependencies.runner.sendCommand = async () => { commands++; throw Error('unexpected Runner'); };
    f.dependencies.releases.publish = async () => { releases++; throw Error('unexpected Release'); };
    const module = f.create(); f.deleting(true);
    try {
      await expect(module.api.publish(workspaceActor, f.project, { branch: 'main', version: 'v0.1.1' })).rejects.toThrow('controlled-project-deleting');
      expect(commands).toBe(0); expect(releases).toBe(0);
    } finally { await Promise.all(module.workers.map(worker => worker.stop())); await f.drop(); }
  });
});
