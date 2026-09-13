import { and, count, eq, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { TaskId, UserId } from '@crewstation/contracts';
import { quotaExceeded } from '@crewstation/kernel';
import type { NativeTerminalRepository, NativeTerminalStart } from '../../ports/nativeTerminals';
import { nativeTerminalStarts as table } from './nativeTerminalTable';

const requestKey = (taskId: TaskId, actorId: UserId, requestId: string) => and(eq(table.taskId, taskId), eq(table.createdBy, actorId), eq(table.clientRequestId, requestId));
const toStart = (row: typeof table.$inferSelect): NativeTerminalStart => ({ ...row, taskId: row.taskId as TaskId, createdBy: row.createdBy as UserId });

export function drizzleNativeTerminals(db: Database): NativeTerminalRepository {
  return {
    async findRequest(taskId, actorId, requestId) {
      const row = (await db.select().from(table).where(requestKey(taskId, actorId, requestId)))[0];
      return row ? toStart(row) : undefined;
    },
    async reserve(input) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dev_session.native_terminals'), hashtext(${input.taskId}))`);
        const existing = (await tx.select().from(table).where(requestKey(input.taskId, input.createdBy, input.clientRequestId)))[0];
        if (existing) return toStart(existing);
        const total = (await tx.select({ total: count() }).from(table).where(eq(table.taskId, input.taskId)))[0]?.total ?? 0;
        if (total >= 256) throw quotaExceeded('本开发会话的 CLI 名册达到 256 条上限');
        const inserted = (await tx.insert(table).values({ ...input, agentId: input.record.agentId }).returning())[0]!;
        return toStart(inserted);
      });
    },
    list: async (taskId) => (await db.select().from(table).where(eq(table.taskId, taskId)).orderBy(table.agentId).limit(256)).map(toStart),
    async saveRecord(taskId, record) {
      await db.update(table).set({ record }).where(and(eq(table.taskId, taskId), eq(table.agentId, record.agentId), sql`(${table.record}->>'revision')::integer < ${record.revision}`));
    },
  };
}
