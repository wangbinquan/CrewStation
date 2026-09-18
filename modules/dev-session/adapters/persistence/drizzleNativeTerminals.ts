import { and, count, eq, gt, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { TaskId, UserId } from '@crewstation/contracts';
import { quotaExceeded, validation } from '@crewstation/kernel';
import type { NativeTerminalRepository, NativeTerminalStart } from '../../ports/nativeTerminals';
import { nativeTerminalStarts as table } from './nativeTerminalTable';

const requestKey = (taskId: TaskId, actorId: UserId, requestId: string) => and(eq(table.taskId, taskId), eq(table.createdBy, actorId), eq(table.clientRequestId, requestId));
const selection = { taskId: table.taskId, createdBy: table.createdBy, clientRequestId: table.clientRequestId, fingerprint: table.fingerprint, input: table.input, profile: table.profile, record: table.record, execution: table.execution };
type StartRow = Pick<typeof table.$inferSelect, keyof typeof selection>;
const toStart = (row: StartRow): NativeTerminalStart => ({ ...row, taskId: row.taskId as TaskId, createdBy: row.createdBy as UserId, profile: row.profile ?? undefined, execution: row.execution ?? undefined });
const agentKey = (taskId: TaskId, agentId: string) => and(eq(table.taskId, taskId), eq(table.agentId, agentId));

export function drizzleNativeTerminals(db: Database): NativeTerminalRepository {
  return {
    withExecutionLock: (id, operation) => db.transaction(async (tx) => { await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dev_session.native_execution'), hashtext(${id}))`); await operation(); }),
    async findRequest(taskId, actorId, requestId) {
      const row = (await db.select(selection).from(table).where(requestKey(taskId, actorId, requestId)))[0];
      return row ? toStart(row) : undefined;
    },
    async findAgent(taskId, agentId) { const row = (await db.select(selection).from(table).where(agentKey(taskId, agentId)))[0]; return row ? toStart(row) : undefined; },
    async findExecution(id) { const row = (await db.select(selection).from(table).where(eq(table.executionTaskId, id)))[0]; return row ? toStart(row) : undefined; },
    listExecutions: async (after, limit = 32) => (await db.select(selection).from(table).where(and(isNotNull(table.executionTaskId), sql`coalesce(${table.execution}->>'finalized', 'false') <> 'true'`, after ? gt(table.agentId, after) : undefined)).orderBy(table.agentId).limit(limit)).map(toStart),
    async reserve(input) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dev_session.native_terminals'), hashtext(${input.taskId}))`);
        const existing = (await tx.select(selection).from(table).where(requestKey(input.taskId, input.createdBy, input.clientRequestId)))[0];
        if (existing) return toStart(existing);
        const total = (await tx.select({ total: count() }).from(table).where(eq(table.taskId, input.taskId)))[0]?.total ?? 0;
        if (total >= 256) throw quotaExceeded('本开发会话的 CLI 名册达到 256 条上限');
        const inserted = (await tx.insert(table).values({ ...input, profile: input.profile ?? null, agentId: input.record.agentId, executionTaskId: input.execution?.taskId }).returning(selection))[0]!;
        return toStart(inserted);
      });
    },
    list: async (taskId) => (await db.select(selection).from(table).where(eq(table.taskId, taskId)).orderBy(table.agentId).limit(256)).map(toStart),
    async saveRecord(taskId, record) {
      await db.update(table).set({ record }).where(and(agentKey(taskId, record.agentId), sql`(${table.record}->>'revision')::integer < ${record.revision}`, sql`${table.record}->>'lifecycle' NOT IN ('ended', 'failed')`));
    },
    async requestStop(taskId, agentId) { await db.update(table).set({ execution: sql`jsonb_set(${table.execution}, '{stopRequested}', 'true')` }).where(agentKey(taskId, agentId)); },
    async saveSnapshot(taskId, agentId, result) {
      if (result.status === 'pending') return;
      const snapshot = result.snapshot;
      if (result.status === 'available' && (!snapshot || Buffer.byteLength(snapshot.data) > 2 * 1024 * 1024)) throw validation('CLI 末屏缺失或超过大小上限');
      await db.update(table).set({ execution: sql`jsonb_set(${table.execution}, '{screen}', to_jsonb(${result.status}::text))`, snapshot: snapshot ?? null })
        .where(and(agentKey(taskId, agentId), isNotNull(table.executionTaskId), sql`${table.execution}->>'screen' IS NULL`, sql`${table.record}->>'lifecycle' IN ('ended', 'failed')`,
          snapshot ? and(sql`${table.record}->>'terminalId' = ${snapshot.terminalId}`, sql`${table.record}->>'runnerId' = ${snapshot.runnerId}`) : undefined));
    },
    async getSnapshot(taskId, agentId) {
      const row = (await db.select({ snapshot: table.snapshot, execution: table.execution }).from(table).where(agentKey(taskId, agentId)))[0];
      return { status: row?.execution?.screen ?? 'pending', ...(row?.snapshot ? { snapshot: row.snapshot } : {}) };
    },
    async finalize(taskId, agentId) { await db.update(table).set({ execution: sql`jsonb_set(${table.execution}, '{finalized}', 'true')` }).where(and(agentKey(taskId, agentId), sql`${table.execution}->>'screen' IS NOT NULL`)); },
  };
}
