import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { NativeTerminalStart } from '../ports/nativeTerminals';
import { drizzleNativeTerminals } from '../adapters/persistence/drizzleNativeTerminals';
import { devSessionMigrations } from '../wiring';
import { workspaceActor, workspaceTask } from './workspaceFixture';

const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([devSessionMigrations]); });
afterAll(async () => { await database?.drop(); });

describe.skipIf(!available)('原生 CLI 持久名册', () => {
  test('跨模块实例并发受理同一请求只落一条；JSON 真实对象，旧状态不能覆盖新状态', async () => {
    const repo1 = drizzleNativeTerminals(database.db);
    const repo2 = drizzleNativeTerminals(database.db);
    const input: NativeTerminalStart = {
      taskId: workspaceTask, createdBy: workspaceActor.userId, clientRequestId: crypto.randomUUID(), fingerprint: 'original', driver: 'claude-code', model: 'anthropic/model',
      input: { clientRequestId: crypto.randomUUID(), permission: 'edit', cols: 80, rows: 24 },
      record: { agentId: 'agent-one', terminalId: 'terminal-one', runnerId: crypto.randomUUID(), compute: 'balanced', permission: 'edit', revision: 0, lifecycle: 'starting', startedAt: new Date().toISOString(), cols: 80, rows: 24 },
    };
    const [one, duplicate] = await Promise.all([repo1.reserve(input), repo2.reserve({ ...input, record: { ...input.record, agentId: 'agent-two' } })]);
    expect(one.record.agentId).toBe(duplicate.record.agentId);
    expect(await repo1.list(workspaceTask)).toHaveLength(1);
    const started = { ...one.record, lifecycle: 'running' as const, revision: 2 };
    const ended = { ...started, lifecycle: 'ended' as const, revision: 3 };
    await repo1.saveRecord(workspaceTask, ended);
    await repo2.saveRecord(workspaceTask, started);
    const restored = await drizzleNativeTerminals(database.db).findRequest(workspaceTask, workspaceActor.userId, input.clientRequestId);
    expect(restored?.record).toMatchObject({ lifecycle: 'ended', revision: 3 });
    expect(restored?.model).toBe('anthropic/model');
    const rows = await database.db.execute(sql`select jsonb_typeof(record) as kind from dev_session.native_terminal_starts`);
    expect(rows[0]?.kind).toBe('object');
  });
});
