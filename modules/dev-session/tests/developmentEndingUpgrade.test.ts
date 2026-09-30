import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { runMigrations } from '@crewstation/persistence';
import { devSessionMigrations } from '../wiring';
import { drizzleAgentStarts } from '../adapters/persistence/drizzleAgentStarts';
import { developmentUsageOwnerStore } from '../adapters/persistence/developmentUsage';
import { developmentEndingStore } from '../adapters/persistence/ending/store';
import { developmentEndingFixture } from './developmentEndingFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('数字结束私表的旧库升级', () => {
  test('0014 preserves old finalized execution and accepted owner without leaking new bookkeeping into either value', async () => {
    const current = await createTestDatabase([devSessionMigrations]);
    const previous = await createTestDatabase([{ ...devSessionMigrations, files: devSessionMigrations.files.filter((m) => !m.name.startsWith('0014_')) }]);
    try {
      const f = await developmentEndingFixture(current.db), start = { ...f.start, state: 'ended' as const, finalized: true, endedAt: '2026-09-30T00:15:00.000Z' }, owner = (await f.owner.get(f.child.id))!;
      await previous.db.execute(sql`insert into dev_session.agent_starts
        (agent_id, task_id, created_by, compute, profile, permission, request, execution, execution_task_id, state, cursor, finalized, created_at, ended_at)
        values (${start.agentId},${start.taskId},${start.createdBy},${start.compute},${JSON.stringify(start.profile)}::jsonb,${start.permission},${JSON.stringify(start.request)}::jsonb,${JSON.stringify(start.execution)}::jsonb,${start.execution.taskId},${start.state},${start.cursor},true,${start.createdAt},${start.endedAt})`);
      const { binding, unsupported, closeReason, capabilityPodUid: _capability, ...prepared } = owner;
      await previous.db.execute(sql`insert into dev_session.development_agent_usage (execution_task_id,project_id,workspace_task_id,accepted_at,prepared,binding,unsupported,close_reason)
        values (${start.execution.taskId},${owner.intent.identity.projectId},${start.taskId},${owner.price.acceptedAt},${JSON.stringify(prepared)}::jsonb,${JSON.stringify(binding)}::jsonb,${unsupported},${closeReason})`);
      expect(await runMigrations(previous.db, [devSessionMigrations])).toEqual(['dev_session/0014_development_agent_endings.sql']);
      expect(await drizzleAgentStarts(previous.db).get(start.agentId)).toEqual(start);
      expect(await developmentUsageOwnerStore(previous.db).get(f.child.id)).toEqual(owner);
      expect(await developmentEndingStore(previous.db).get(f.child.id)).toBeUndefined();
      expect(await runMigrations(previous.db, [devSessionMigrations])).toEqual([]);
      const rows = await previous.db.execute(sql`select logical_ending from dev_session.agent_starts where agent_id=${start.agentId}`);
      expect(rows[0]).toEqual({ logical_ending: false });
    } finally { await previous.drop(); await current.drop(); }
  });
});
