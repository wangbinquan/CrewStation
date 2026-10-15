import { randomUUID } from 'node:crypto';
import type { Clock, Logger } from '@crewstation/kernel';
import { precondition } from '@crewstation/kernel';
import type { LedgerScope, LedgerUnitOfWork } from '../ports/repositories';
import type { MaintenanceStep, MaintenanceSweepLease } from '../ports/maintenance';
import { protectedTaskVolume } from '../domain/taskStorage';
import { commitRecord } from './commit';

export const COMPACT_AFTER_MS = 7 * 24 * 3_600_000;
export const CHANGES_RETAIN_MS = 24 * 3_600_000;
const LEASES_RETAIN_MS = 3_600_000;
const BATCH = 100;
const SWEEP_TTL_MS = 30_000;
export const RETENTION_EXPIRED = { code: 'retention-expired', message: '失败保留期已满，平台自动回收' } as const;

/** commitRecord 的路由级联也保留同一个实际 UPDATE fence，整次失租回滚。 */
function maintenanceCommitScope(scope: LedgerScope, lease: MaintenanceSweepLease): LedgerScope {
  return { ...scope, records: { ...scope.records, update: async (record) => {
    if (!await scope.records.updateForMaintenance(record, lease)) throw precondition('资源维护租约已过期或被接管', { code: 'maintenance-lease-lost' });
  } } };
}

/** 每步一个持久游标和租约：多副本只有一个在扫，扫到末尾才换下一轮的截止时间。 */
async function sweep(uow: LedgerUnitOfWork, clock: Clock, step: MaintenanceStep): Promise<number> {
  const lease = await uow.run((scope) => scope.sweeps.claim(step, randomUUID(), SWEEP_TTL_MS, step === 'compaction' ? clock.now() : undefined));
  if (!lease) return 0;
  let changed = 0;
  try {
    const page = await uow.read.records.maintenancePage(lease, COMPACT_AFTER_MS, BATCH);
    for (const candidate of page) {
      changed += await uow.run(async (scope) => {
        await scope.sweeps.requireCurrent(lease);
        const record = await scope.records.get(candidate.id, { forUpdate: true });
        const at = await scope.sweeps.requireCurrent(lease);
        if (!record) return 0;
        if (step === 'retention') {
          if (protectedTaskVolume(record) || record.desired !== 'present' || record.phase !== 'failed' || !record.retainUntil || record.retainUntil >= at) return 0;
          await commitRecord(maintenanceCommitScope(scope, lease), record, { ...record, desired: 'absent', generation: record.generation + 1, releaseReason: RETENTION_EXPIRED }, clock.now());
        } else {
          if (record.desired !== 'absent' || record.phase !== 'stopped' || record.compactedAt || record.phaseSince.getTime() >= lease.scanCutoff.getTime() - COMPACT_AFTER_MS) return 0;
          const compacted = await scope.records.compactForMaintenance(record, clock.now(), lease);
          if (!compacted) return 0;
          await scope.changes.append({ ...(record.projectId ? { projectId: record.projectId } : {}), resourceId: record.id, version: compacted.version, change: 'remove' });
        }
        await scope.sweeps.requireCommitCurrent(lease);
        return 1;
      });
    }
    await uow.run((scope) => scope.sweeps.finish(lease, page.at(-1)?.id ?? lease.afterId, page.length === 0, step === 'compaction' ? clock.now() : undefined));
    return changed;
  } finally { await uow.run((scope) => scope.sweeps.release(lease)); }
}

export function expireRetention(uow: LedgerUnitOfWork, clock: Clock): Promise<number> {
  return sweep(uow, clock, 'retention');
}

export function compactStopped(uow: LedgerUnitOfWork, clock: Clock): Promise<number> {
  return sweep(uow, clock, 'compaction');
}

export async function maintainLedger(uow: LedgerUnitOfWork, clock: Clock, logger: Logger): Promise<void> {
  const now = clock.now();
  const steps: [string, () => Promise<number>][] = [
    ['retention', () => expireRetention(uow, clock)],
    ['compaction', () => compactStopped(uow, clock)],
    ['changes', () => uow.read.changes.pruneBefore(new Date(now.getTime() - CHANGES_RETAIN_MS))],
    ['leases', () => uow.read.leases.prune(new Date(now.getTime() - LEASES_RETAIN_MS))],
  ];
  for (const [step, run] of steps) {
    try { const count = await run(); if (count) logger.info('resource ledger maintenance', { step, count }); }
    catch (error) { logger.warn('resource ledger maintenance failed', { step, error: String(error) }); }
  }
}
