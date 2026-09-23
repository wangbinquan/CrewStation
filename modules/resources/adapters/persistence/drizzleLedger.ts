import type { Database, Executor } from '@crewstation/persistence';
import { and, asc, eq, gt, isNotNull, lt, sql } from 'drizzle-orm';
import type { ChangeEntry, ChangeLog, LeaseStore, LedgerScope, LedgerUnitOfWork, ProjectLocks } from '../../ports/repositories';
import { drizzleRecordRepository } from './drizzleRecords';
import { changes, leases, projectLocks } from './tables';

export function drizzleChangeLog(db: Executor): ChangeLog {
  return {
    append: async (entry) => { await db.insert(changes).values({ projectId: entry.projectId ?? null, resourceId: entry.resourceId, version: entry.version, change: entry.change }); },
    since: async (seq, limit, projectId) => (await db.select().from(changes)
      .where(and(gt(changes.seq, seq), projectId ? eq(changes.projectId, projectId) : undefined))
      .orderBy(asc(changes.seq)).limit(Math.min(1000, Math.max(1, limit))))
      .map((row): ChangeEntry => ({ seq: row.seq!, ...(row.projectId ? { projectId: row.projectId } : {}), resourceId: row.resourceId, version: row.version, change: row.change as ChangeEntry['change'], at: row.at })),
    latest: async () => Number((await db.select({ seq: sql<string | null>`max(${changes.seq})` }).from(changes))[0]?.seq ?? 0),
    earliest: async () => {
      const row = (await db.select({ min: sql<string | null>`min(${changes.seq})`, max: sql<string | null>`max(${changes.seq})` }).from(changes))[0];
      return Number(row?.min ?? row?.max ?? 0);
    },
    pruneBefore: async (at) => (await db.delete(changes)
      .where(and(lt(changes.at, at), isNotNull(changes.seq), lt(changes.seq, sql`(SELECT max(seq) FROM resources.changes)`))).returning({ id: changes.id })).length,
  };
}

export function drizzleLeaseStore(db: Executor): LeaseStore {
  const until = (ttlMs: number) => sql`now() + ${`${Math.max(1, Math.round(ttlMs))} milliseconds`}::interval`;
  return {
    acquire: async (resourceId, holder, ttlMs) => (await db.insert(leases).values({ resourceId, holder, expiresAt: until(ttlMs) })
      .onConflictDoUpdate({ target: leases.resourceId, set: { holder, expiresAt: until(ttlMs) }, setWhere: sql`${leases.expiresAt} < now() OR ${leases.holder} = ${holder}` })
      .returning({ holder: leases.holder })).length === 1,
    renew: async (resourceId, holder, ttlMs) => (await db.update(leases).set({ expiresAt: until(ttlMs) })
      .where(and(eq(leases.resourceId, resourceId), eq(leases.holder, holder))).returning({ holder: leases.holder })).length === 1,
    release: async (resourceId, holder) => { await db.delete(leases).where(and(eq(leases.resourceId, resourceId), eq(leases.holder, holder))); },
    prune: async (expiredBefore) => (await db.delete(leases).where(lt(leases.expiresAt, expiredBefore)).returning({ id: leases.resourceId })).length,
  };
}

export function drizzleProjectLocks(db: Executor): ProjectLocks {
  return {
    lock: async (projectId) => {
      await db.insert(projectLocks).values({ projectId }).onConflictDoNothing();
      await db.select().from(projectLocks).where(eq(projectLocks.projectId, projectId)).for('update');
    },
  };
}

export function ledgerScopeOver(executor: Executor): LedgerScope {
  return { records: drizzleRecordRepository(executor), changes: drizzleChangeLog(executor), leases: drizzleLeaseStore(executor), locks: drizzleProjectLocks(executor) };
}

/** 台账的事务单元；within 加入调用方（所属模块）已开的事务。 */
export function drizzleLedgerUnitOfWork(db: Database): LedgerUnitOfWork & { within(executor: Executor): LedgerScope } {
  return { read: ledgerScopeOver(db), run: (fn) => db.transaction((tx) => fn(ledgerScopeOver(tx))), within: ledgerScopeOver };
}
