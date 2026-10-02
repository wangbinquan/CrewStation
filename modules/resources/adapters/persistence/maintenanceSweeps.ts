import type { Executor } from '@crewstation/persistence';
import { precondition } from '@crewstation/kernel';
import { and, eq, sql } from 'drizzle-orm';
import { bigint, text, timestamp } from 'drizzle-orm/pg-core';
import type { MaintenanceStep } from '../../domain/maintenanceEnding';
import type { MaintenanceSweepLease, MaintenanceSweepRepository } from '../../ports/maintenance';
import { resourcesSchema } from './schema';

export const maintenanceSweeps = resourcesSchema.table('maintenance_sweeps', {
  step: text('step').primaryKey(), scanCutoff: timestamp('scan_cutoff', { withTimezone: true }).notNull(), afterId: text('after_id'),
  epoch: bigint('epoch', { mode: 'number' }).notNull(), leaseHolder: text('lease_holder'), leaseUntil: timestamp('lease_until', { withTimezone: true }),
  fencingToken: bigint('fencing_token', { mode: 'number' }).notNull(),
});

const lost = () => precondition('资源维护租约已过期或被接管', { code: 'maintenance-lease-lost' });
const identity = (lease: MaintenanceSweepLease) => and(eq(maintenanceSweeps.step, lease.step), eq(maintenanceSweeps.epoch, lease.epoch),
  eq(maintenanceSweeps.leaseHolder, lease.holder), eq(maintenanceSweeps.fencingToken, lease.fencingToken));

/** 实际 UPDATE 的数据库时钟条件；不是调用方刚刚读过时刻的近似。 */
export function currentMaintenanceLease(lease: MaintenanceSweepLease) {
  return sql`exists (select 1 from ${maintenanceSweeps} where ${identity(lease)} and ${maintenanceSweeps.leaseUntil} > clock_timestamp())`;
}

async function databaseNow(db: Executor): Promise<Date> {
  const rows = await db.execute(sql`SELECT clock_timestamp() AS at`) as unknown as { at: Date | string }[];
  if (!rows[0]) throw new Error('数据库维护时钟没有返回值');
  return new Date(rows[0].at);
}

export function drizzleMaintenanceSweeps(db: Executor): MaintenanceSweepRepository {
  const lock = async (step: MaintenanceStep) => (await db.select().from(maintenanceSweeps).where(eq(maintenanceSweeps.step, step)).for('update'))[0];
  const requireCurrent = async (lease: MaintenanceSweepLease): Promise<Date> => {
    const row = await lock(lease.step);
    const at = await databaseNow(db);
    if (!row || row.epoch !== lease.epoch || row.leaseHolder !== lease.holder || row.fencingToken !== lease.fencingToken || !row.leaseUntil || row.leaseUntil <= at) throw lost();
    return at;
  };
  return {
    claim: async (step, holder, ttlMs, initialCutoff) => {
      await db.insert(maintenanceSweeps).values({ step, scanCutoff: initialCutoff ?? sql`clock_timestamp()`, epoch: 1, fencingToken: 0 }).onConflictDoNothing();
      const row = await lock(step);
      const at = await databaseNow(db);
      if (!row || (row.leaseUntil && row.leaseUntil > at)) return undefined;
      const fencingToken = row.fencingToken + 1;
      await db.update(maintenanceSweeps).set({ leaseHolder: holder, leaseUntil: new Date(at.getTime() + Math.max(1, ttlMs)), fencingToken }).where(eq(maintenanceSweeps.step, step));
      return { step, scanCutoff: row.scanCutoff, afterId: row.afterId, epoch: row.epoch, holder, fencingToken };
    },
    requireCurrent,
    requireCommitCurrent: async (lease) => {
      // The deferred stamp may wait for the global change-order lock; flush it last.
      await db.execute(sql`SET CONSTRAINTS resources.changes_stamp IMMEDIATE`);
      return requireCurrent(lease);
    },
    renew: async (lease, ttlMs) => {
      const at = await requireCurrent(lease);
      const rows = await db.update(maintenanceSweeps).set({ leaseUntil: new Date(at.getTime() + Math.max(1, ttlMs)) })
        .where(and(identity(lease), sql`${maintenanceSweeps.leaseUntil} > clock_timestamp()`)).returning({ step: maintenanceSweeps.step });
      if (!rows.length) throw lost();
    },
    finish: async (lease, afterId, eof, nextCutoff) => {
      const at = await requireCurrent(lease);
      const rows = await db.update(maintenanceSweeps).set({ afterId: eof ? null : afterId, ...(eof ? { scanCutoff: nextCutoff ?? at, epoch: lease.epoch + 1 } : {}), leaseHolder: null, leaseUntil: null })
        .where(and(identity(lease), sql`${maintenanceSweeps.leaseUntil} > clock_timestamp()`)).returning({ step: maintenanceSweeps.step });
      if (!rows.length) throw lost();
    },
    release: async (lease) => {
      await lock(lease.step);
      await databaseNow(db);
      await db.update(maintenanceSweeps).set({ leaseHolder: null, leaseUntil: null })
        .where(and(identity(lease), sql`${maintenanceSweeps.leaseUntil} > clock_timestamp()`));
    },
  };
}
