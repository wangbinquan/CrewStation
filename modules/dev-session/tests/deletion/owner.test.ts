import { describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { seedDevelopmentContent } from './contentFixture';
import { developmentWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('development deletion owner (actual PG; controlled original public sources and prior physical grants)', () => {
  test('all seven phases purge the full original content, preserve another project and retain no private bodies in the receipt', async () => {
    const f = await developmentWorkFixture();
    try {
      await seedDevelopmentContent(f); await f.database.db.execute('UPDATE dev_session.agent_starts SET finalized=true');
      await f.database.db.execute(sql`INSERT INTO dev_session.workspace_layouts(task_id,user_id,revision,layout)
        VALUES(${f.otherWorkspace},${newResourceId()},1,'{"private":"foreign-layout"}')`);
      await f.work.run(f.input(), async () => undefined);
      const confirmed = await f.owner().inspect(f.target); expect(confirmed.complete).toBe(true); expect(confirmed.resources).toHaveLength(14);
      await expect(f.owner().run(f.context(confirmed, 'metadata'))).rejects.toThrow();
      const firstSeal = await f.owner().run(f.context(confirmed)); expect(firstSeal.kind).toBe('done');
      let generation = 1;
      for (const phase of PROJECT_DELETION_PHASES) {
        const first = await f.owner().run(f.context(confirmed, phase, generation)); expect(first.kind).toBe('done');
        expect(await f.owner().run(f.context(confirmed, phase, ++generation))).toEqual(first);
      }
      expect((await f.owner().inspect(f.target)).resources).toEqual([]);
      expect([...await f.database.db.execute('SELECT task_id,layout FROM dev_session.workspace_layouts')]).toEqual([{ task_id: f.otherWorkspace, layout: { private: 'foreign-layout' } }]);
      const state = (await f.database.db.execute<{ body: Record<string, unknown>; phases: unknown }>('SELECT body,phases FROM dev_session.project_deletions'))[0]!;
      expect(state.body).toMatchObject({ contents: [], callbacks: [], compacted: true, count: 14 });
      for (const value of ['terminal-private', 'private-comparison', 'usage-private', 'activity-private', 'prompt', 'profile', 'foreign-layout']) expect(JSON.stringify(state)).not.toContain(value);
      expect(await f.database.db.execute('SELECT kind,key FROM dev_session.content_origins')).not.toHaveLength(0);
      for (const mutation of [sql`INSERT INTO dev_session.workspace_layouts(task_id,user_id,revision,layout) VALUES(${f.workspace},${newResourceId()},1,'{}')`,
        sql`INSERT INTO dev_session.idle_reminders(task_id,last_reminder_at) VALUES(${f.workspace},now())`, sql`TRUNCATE dev_session.project_deletions`,
        sql`DELETE FROM dev_session.content_origins`, sql`UPDATE dev_session.project_deletions SET body='{}'`]) await expect(f.database.db.execute(mutation).then(() => undefined)).rejects.toThrow();
    } finally { await f.drop(); }
  });

  test('changed confirmed content seals writes, refuses the stale scope and accepts only a later generation of the same operation', async () => {
    const f = await developmentWorkFixture();
    try {
      await seedDevelopmentContent(f); const confirmed = await f.owner().inspect(f.target);
      await f.database.db.execute(sql`UPDATE dev_session.workspace_layouts SET layout='{"private":"changed-after-confirmation"}' WHERE task_id=${f.workspace}`);
      expect(await f.owner().run(f.context(confirmed))).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
      await expect(f.database.db.execute(sql`UPDATE dev_session.idle_reminders SET last_reminder_at=now() WHERE task_id=${f.workspace}`).then(() => undefined)).rejects.toThrow();
      const current = await f.owner().inspect(f.target); await expect(f.owner().run(f.context(current))).rejects.toThrow('世代');
      expect((await f.owner().run(f.context(current, 'seal', 2))).kind).toBe('done');
      await expect(f.repo().record(f.context(current, 'seal', 2), { kind: 'metadata', count: 0, digest: jsonHash('false replacement'), description: 'false replacement' })).rejects.toThrow('不能替换');
      await expect(f.owner().run({ ...f.context(current, 'stop', 2), operationId: newResourceId() })).rejects.toThrow();
      expect((await f.owner().run(f.context(current, 'stop', 2))).kind).toBe('waiting');
    } finally { await f.drop(); }
  });

  test('a missing original source or a late revoked grant never produces a successful seal', async () => {
    const f = await developmentWorkFixture();
    try {
      await seedDevelopmentContent(f); f.unavailable.add('task:' + f.workspace);
      expect(await f.owner().inspect(f.target)).toMatchObject({ complete: false, blockers: [{ code: 'source-unavailable' }] });
      f.unavailable.clear(); const confirmed = await f.owner().inspect(f.target);
      let grants = 0; f.checkingGrant(async () => { if (++grants === 3) f.permit(false); });
      await expect(f.owner().run(f.context(confirmed))).rejects.toThrow('grant-unavailable');
      expect(await f.database.db.execute('SELECT project_id FROM dev_session.project_admissions')).toHaveLength(0);
      expect(await f.database.db.execute('SELECT project_id FROM dev_session.project_deletions')).toHaveLength(0);
      f.permit(true); f.checkingGrant(async () => undefined);
      await expect(f.owner().run(f.context({ ...confirmed, participant: 'session' }))).rejects.toThrow('完整原确认');
      await expect(f.owner().run(f.context({ ...confirmed, complete: false }))).rejects.toThrow('完整原确认');
    } finally { await f.drop(); }
  });
});
