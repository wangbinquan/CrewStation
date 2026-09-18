import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { TaskIdSchema } from '@crewstation/contracts';
import { newId } from '@crewstation/kernel';
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
  test('执行绑定、停止意图与末屏跨实例保持；名册不携带屏幕，迟到运行态不能覆盖结束', async () => {
    const repo = drizzleNativeTerminals(database.db), other = drizzleNativeTerminals(database.db), taskId = TaskIdSchema.parse(newId('tsk'));
    const input: NativeTerminalStart = { taskId, createdBy: workspaceActor.userId, clientRequestId: crypto.randomUUID(), fingerprint: 'execution', profile: { profile: 'balanced', revision: 2 },
      input: { clientRequestId: crypto.randomUUID(), permission: 'edit', cols: 80, rows: 24 }, execution: { taskId: TaskIdSchema.parse(newId('tsk')), taskProfile: 'cli-small' },
      record: { agentId: newId('agt'), terminalId: newId('pty'), runnerId: crypto.randomUUID(), compute: 'balanced', permission: 'edit', revision: 2, lifecycle: 'running', startedAt: new Date().toISOString(), cols: 80, rows: 24 } };
    await repo.reserve(input); await other.requestStop(taskId, input.record.agentId);
    expect((await repo.findExecution(input.execution!.taskId))?.execution).toMatchObject({ taskProfile: 'cli-small', stopRequested: true });
    const snapshot = { terminalId: input.record.terminalId, runnerId: input.record.runnerId, cols: 80, rows: 24, data: 'final screen', throughSeq: 2, scrollbackLimit: 500, truncated: true };
    await repo.saveSnapshot(taskId, input.record.agentId, { status: 'available', snapshot });
    expect(await other.getSnapshot(taskId, input.record.agentId)).toEqual({ status: 'pending' });
    await repo.saveRecord(taskId, { ...input.record, lifecycle: 'ended', revision: 3 });
    await other.saveRecord(taskId, { ...input.record, lifecycle: 'running', revision: 100 });
    await repo.saveSnapshot(taskId, input.record.agentId, { status: 'available', snapshot: { ...snapshot, terminalId: 'wrong' } });
    expect(await repo.getSnapshot(taskId, input.record.agentId)).toEqual({ status: 'pending' });
    await repo.saveSnapshot(taskId, input.record.agentId, { status: 'available', snapshot });
    await other.saveSnapshot(taskId, input.record.agentId, { status: 'unavailable' });
    await repo.finalize(taskId, input.record.agentId);
    expect(await other.getSnapshot(taskId, input.record.agentId)).toEqual({ status: 'available', snapshot });
    const record = await other.findAgent(taskId, input.record.agentId);
    expect(record?.record).toMatchObject({ lifecycle: 'ended', revision: 3 }); expect(record?.execution?.finalized).toBe(true);
    expect(record).not.toHaveProperty('snapshot'); expect((await other.list(taskId))[0]).not.toHaveProperty('snapshot');
    expect((await other.listExecutions()).some((r) => r.record.agentId === input.record.agentId)).toBe(false);
    await expect(repo.saveSnapshot(taskId, input.record.agentId, { status: 'available', snapshot: { ...snapshot, data: 'x'.repeat(2 * 1024 * 1024 + 1) } })).rejects.toMatchObject({ kind: 'validation' });
  });

  test('不同模块实例对同一执行串行，其他执行仍能推进', async () => {
    const repo = drizzleNativeTerminals(database.db), other = drizzleNativeTerminals(database.db), id = TaskIdSchema.parse(newId('tsk')), trace: string[] = [];
    let entered!: () => void, finish!: () => void;
    const started = new Promise<void>((done) => { entered = done; });
    const first = repo.withExecutionLock(id, async () => { trace.push('first'); entered(); await new Promise<void>((done) => { finish = done; }); });
    await started;
    const second = other.withExecutionLock(id, async () => { trace.push('second'); });
    await other.withExecutionLock(TaskIdSchema.parse(newId('tsk')), async () => { trace.push('other'); });
    expect(trace).toEqual(['first', 'other']); finish(); await Promise.all([first, second]);
    expect(trace).toEqual(['first', 'other', 'second']);
  });

  test('跨模块实例并发受理同一请求只落一条；JSON 真实对象，旧状态不能覆盖新状态', async () => {
    const repo1 = drizzleNativeTerminals(database.db);
    const repo2 = drizzleNativeTerminals(database.db);
    const input: NativeTerminalStart = {
      taskId: workspaceTask, createdBy: workspaceActor.userId, clientRequestId: crypto.randomUUID(), fingerprint: 'original', profile: { profile: 'balanced', revision: 7 },
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
    expect(restored?.profile).toEqual({ profile: 'balanced', revision: 7 });
    const rows = await database.db.execute(sql`select jsonb_typeof(record) as kind from dev_session.native_terminal_starts`);
    expect(rows[0]?.kind).toBe('object');
  });
});
