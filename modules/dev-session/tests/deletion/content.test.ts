import { describe, expect, test } from 'bun:test';
import { TaskIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { DEVELOPMENT_CONTENT } from '../../adapters/persistence/deletion/contentTables';
import { devSessionMigrations } from '../../wiring';
import { developmentContentFixture, seedDevelopmentContent } from './contentFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('development content inventory (actual read-only PG; controlled original public identities)', () => {
  test('traverses all 13 content families and the original callback catalog, retains foreign history and exports no private payload', async () => {
    const f = await developmentContentFixture();
    try {
      const seeded = await seedDevelopmentContent(f), rows = Array.from({ length: 205 }, () => ({ user_id: newResourceId() }));
      await f.database.db.execute(sql`INSERT INTO dev_session.workspace_layouts(task_id,user_id,revision,layout)
        SELECT ${f.workspace},x.user_id,1,'{"private":"historical-layout"}'::jsonb FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) x(user_id text)`);
      await f.database.db.execute(sql`INSERT INTO dev_session.workspace_layouts(task_id,user_id,revision,layout)
        VALUES(${f.otherWorkspace},${newResourceId()},1,'{"private":"other-project-layout"}')`);
      const before = await f.database.db.execute('SELECT task_id,user_id,layout FROM dev_session.workspace_layouts ORDER BY task_id,user_id');
      const inspected = await f.inspect();
      expect(DEVELOPMENT_CONTENT).toHaveLength(14); expect(inspected.inventory.complete).toBe(true); expect(inspected.inventory.resources).toHaveLength(13);
      expect(inspected.traversal.counts.workspace_layouts).toBe(207);
      expect(inspected.inventory.resources.find((row) => row.id === 'workspace_layouts')?.count).toBe(206);
      expect(inspected.contents).toHaveLength(218); expect(inspected.contents.some((row) => row.key.includes(f.otherWorkspace))).toBe(false);
      expect(inspected.origins.find((row) => row.key === seeded.reserved)).toMatchObject({ kind: 'task', projectId: f.project });
      for (const privateText of ['prompt', 'terminal-private', 'historical-layout', 'private-comparison', 'activity-private', 'usage-private', 'other-project-layout'])
        expect(JSON.stringify(inspected)).not.toContain(privateText);
      expect(f.requests.filter((value) => value === 'task:' + f.workspace + ':current')).toHaveLength(1);
      expect(await f.database.db.execute('SELECT task_id,user_id,layout FROM dev_session.workspace_layouts ORDER BY task_id,user_id')).toEqual(before);
      expect(await f.inspect()).toEqual(inspected);
      await f.database.db.execute(sql`UPDATE dev_session.workspace_layouts SET layout='{"private":"changed"}' WHERE task_id=${f.workspace} AND user_id=${rows[204]!.user_id}`);
      expect((await f.inspect()).inventory.revision).not.toBe(inspected.inventory.revision);
    } finally { await f.database.drop(); }
  }, 15000);

  test('a not-yet-created child requires its actual original workspace; unavailable sources never become a fallback', async () => {
    const f = await developmentContentFixture();
    try {
      const child = await f.agent();
      expect((await f.inspect()).inventory.resources.find((row) => row.id === 'agent_starts')?.count).toBe(1);
      f.unavailable.add('task:' + child.id); await expect(f.inspect()).rejects.toThrow('source offline'); f.unavailable.clear();
      f.origins.delete('task:' + f.workspace); await expect(f.inspect()).rejects.toThrow('来源缺失');
      f.bind('task', f.workspace); f.bind('task', child.id, f.otherProject); await expect(f.inspect()).rejects.toThrow('项目归属冲突');
      f.origins.delete('task:' + child.id);
      await expect(f.database.db.execute(sql`UPDATE dev_session.agent_starts SET task_id=execution_task_id WHERE agent_id=${child.agentId}`).then(() => undefined)).rejects.toThrow();
      expect((await f.inspect()).inventory.complete).toBe(true);
    } finally { await f.database.drop(); }
  });

  test('reserved restart identities require the original management operation and reject a foreign created task', async () => {
    const f = await developmentContentFixture();
    try {
      const operation = newResourceId(), reserved = newResourceId();
      await f.database.db.execute(sql`INSERT INTO dev_session.cluster_agent_restarts(operation_id,agent_id,task_id) VALUES(${operation},${newResourceId()},${reserved})`);
      await expect(f.inspect()).rejects.toThrow('来源缺失');
      f.bind('cluster-operation', operation); expect((await f.inspect()).inventory.resources[0]?.count).toBe(1);
      f.unavailable.add('task:' + reserved); await expect(f.inspect()).rejects.toThrow('source offline'); f.unavailable.clear();
      f.bind('task', reserved, f.otherProject); await expect(f.inspect()).rejects.toThrow('项目归属冲突');
    } finally { await f.database.drop(); }
  });

  test('unknown schemas, missing tables and contradictory current identity aliases cannot masquerade as complete', async () => {
    const f = await developmentContentFixture();
    try {
      expect((await f.inspect()).inventory.resources).toEqual([]);
      await f.database.db.execute('CREATE TABLE dev_session.unknown_history(task_id text,payload jsonb)');
      await expect(f.inspect()).rejects.toThrow('未登记'); await f.database.db.execute('DROP TABLE dev_session.unknown_history');
      const directory = resourceIdentityDirectory(f.database.db, () => [devSessionMigrations]);
      await directory.bind('dev_session', 'task', [f.workspace], newResourceId()); await expect(f.inspect()).rejects.toThrow('原标识目录冲突');
      await f.database.db.execute('DELETE FROM dev_session.resource_identity_aliases');
      await f.database.db.execute('DROP TABLE dev_session.comparison_references'); await expect(f.inspect()).rejects.toThrow('缺失');
    } finally { await f.database.drop(); }
  });

  test('native activity, accepted executions and usage receipts cannot borrow another parent or original identity', async () => {
    const f = await developmentContentFixture();
    try {
      const seeded = await seedDevelopmentContent(f), foreign = await f.native(f.otherWorkspace);
      await expect(f.database.db.execute(sql`UPDATE dev_session.native_activity_reads SET agent_id=${foreign.agentId} WHERE task_id=${f.workspace}`).then(() => undefined)).rejects.toThrow();
      await expect(f.database.db.execute(sql`UPDATE dev_session.native_activity_sources SET source_task_id=${foreign.id} WHERE task_id=${f.workspace}`).then(() => undefined)).rejects.toThrow();
      await f.database.db.execute(sql`UPDATE dev_session.development_agent_usage SET prepared=jsonb_set(prepared,'{intent,identity,executionId}',to_jsonb(${foreign.id}::text))`);
      await expect(f.inspect()).rejects.toThrow('原内容关系');
      await f.database.db.execute(sql`UPDATE dev_session.development_agent_usage SET prepared=jsonb_set(prepared,'{intent,identity,executionId}',to_jsonb(${seeded.headless.id}::text))`);
      await f.database.db.execute(sql`UPDATE dev_session.agent_starts SET execution=jsonb_set(execution,'{taskId}',to_jsonb(${foreign.id}::text))`);
      await expect(f.inspect()).rejects.toThrow('原内容关系');
    } finally { await f.database.drop(); }
  });

  test('history must map to the same original agent, including content belonging to a parent-only legacy terminal', async () => {
    const f = await developmentContentFixture();
    try {
      const cli = await f.native(f.workspace, null), directory = resourceIdentityDirectory(f.database.db, () => [devSessionMigrations]);
      await f.database.db.execute(sql`UPDATE dev_session.native_terminal_starts SET legacy_record='{"agentId":"original-old-cli"}' WHERE agent_id=${cli.agentId}`);
      await expect(f.inspect()).rejects.toThrow('同一原 Agent');
      await directory.bind('dev_session', 'agent', ['original-old-cli'], cli.agentId);
      expect((await f.inspect()).inventory.resources[0]?.count).toBe(1);
      await f.database.db.execute(sql`UPDATE dev_session.native_terminal_starts SET legacy_record=${JSON.stringify({ agentId: newResourceId() })}::jsonb WHERE agent_id=${cli.agentId}`);
      await expect(f.inspect()).rejects.toThrow('同一原 Agent');
      await f.database.db.execute(sql`UPDATE dev_session.native_terminal_starts SET legacy_record=NULL,record=jsonb_set(record,'{agentId}',to_jsonb(${newResourceId()}::text)) WHERE agent_id=${cli.agentId}`);
      await expect(f.inspect()).rejects.toThrow('原内容关系');
    } finally { await f.database.drop(); }
  });

  test('replaced or shared public workspace witnesses cannot confirm private accepted content', async () => {
    const f = await developmentContentFixture();
    try {
      await f.agent(); const original = f.origins.get('task:' + f.workspace)!;
      f.origins.set('task:' + f.workspace, { ...original, id: newResourceId() }); await expect(f.inspect()).rejects.toThrow('原对象 ID');
      f.origins.set('task:' + f.workspace, { ...original, projectIds: [f.project, f.otherProject] }); await expect(f.inspect()).rejects.toThrow('共享');
      f.origins.set('task:' + f.workspace, { ...original, scope: 'platform', projectIds: [] }); await expect(f.inspect()).rejects.toThrow('实际原父工作区');
      f.origins.set('task:' + f.workspace, original); expect((await f.inspect()).inventory.complete).toBe(true);
    } finally { await f.database.drop(); }
  });

  test('a CLI and a headless acceptance cannot share an execution or agent identity', async () => {
    const f = await developmentContentFixture();
    try {
      const cli = await f.native(), agent = await f.agent();
      await expect(f.database.db.execute(sql`UPDATE dev_session.agent_starts SET execution_task_id=${cli.id},execution=jsonb_set(execution,'{taskId}',to_jsonb(${cli.id}::text)) WHERE agent_id=${agent.agentId}`).then(() => undefined)).rejects.toThrow();
      await expect(f.database.db.execute(sql`UPDATE dev_session.agent_starts SET agent_id=${cli.agentId} WHERE agent_id=${agent.agentId}`).then(() => undefined)).rejects.toThrow();
      await f.agent(f.workspace, TaskIdSchema.parse(cli.id));
      await expect(f.inspect()).rejects.toThrow('原内容关系');
    } finally { await f.database.drop(); }
  });
});
