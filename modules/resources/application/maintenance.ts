import { randomUUID } from 'node:crypto';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger } from '@crewstation/kernel';
import type { LedgerUnitOfWork } from '../ports/repositories';
import type { MaintenanceEndingDecision, MaintenanceStep } from '../domain/maintenanceEnding';
import { maintenanceSnapshot } from '../domain/maintenanceEnding';
import { protectedTaskVolume } from '../domain/taskStorage';
import { commitRecord } from './commit';
import type { MaintenanceEndingRegistry } from './maintenanceEnding';
import { inspectMaintenanceEnding, maintenanceCommitScope, permitsMaintenance } from './maintenanceEnding';

export const COMPACT_AFTER_MS = 7 * 24 * 3_600_000;
export const CHANGES_RETAIN_MS = 24 * 3_600_000;
const LEASES_RETAIN_MS = 3_600_000;
const BATCH = 100;
const SWEEP_TTL_MS = 30_000;
export const RETENTION_EXPIRED = { code: 'retention-expired', message: '失败保留期已满，平台自动回收' } as const;

async function sweep(uow: LedgerUnitOfWork, clock: Clock, step: MaintenanceStep, handlers: MaintenanceEndingRegistry, logger: Logger): Promise<number> {
  const lease = await uow.run((scope) => scope.sweeps.claim(step, randomUUID(), SWEEP_TTL_MS, step === 'compaction' ? clock.now() : undefined));
  if (!lease) return 0;
  let changed = 0;
  try {
    const page = await uow.read.records.maintenancePage(lease, COMPACT_AFTER_MS, BATCH);
    for (const candidate of page) {
      await uow.run((scope) => scope.sweeps.renew(lease, SWEEP_TTL_MS));
      let decision: MaintenanceEndingDecision;
      try { decision = await inspectMaintenanceEnding(uow, step, candidate, handlers); }
      catch (error) { logger.warn('resource maintenance owner waiting', { resourceId: candidate.id, step, error: String(error) }); continue; }
      await uow.run((scope) => scope.sweeps.renew(lease, SWEEP_TTL_MS));
      if (decision.status === 'waiting') continue;
      const snapshot = maintenanceSnapshot(candidate);
      changed += await uow.run(async (scope) => {
        await scope.sweeps.requireCurrent(lease);
        const record = await scope.records.get(candidate.id, { forUpdate: true });
        const at = await scope.sweeps.requireCurrent(lease);
        if (!record || !permitsMaintenance(record, snapshot, decision)) return 0;
        if (decision.status === 'unselected' && await scope.records.maintenanceOwnerRequired(record.id)) return 0;
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

export function expireRetention(uow: LedgerUnitOfWork, clock: Clock, handlers: MaintenanceEndingRegistry = new Map(), logger: Logger = noopLogger): Promise<number> {
  return sweep(uow, clock, 'retention', handlers, logger);
}

export function compactStopped(uow: LedgerUnitOfWork, clock: Clock, handlers: MaintenanceEndingRegistry = new Map(), logger: Logger = noopLogger): Promise<number> {
  return sweep(uow, clock, 'compaction', handlers, logger);
}

export async function maintainLedger(uow: LedgerUnitOfWork, clock: Clock, logger: Logger, handlers: MaintenanceEndingRegistry = new Map()): Promise<void> {
  const now = clock.now();
  const steps: [string, () => Promise<number>][] = [
    ['retention', () => expireRetention(uow, clock, handlers, logger)],
    ['compaction', () => compactStopped(uow, clock, handlers, logger)],
    ['changes', () => uow.read.changes.pruneBefore(new Date(now.getTime() - CHANGES_RETAIN_MS))],
    ['leases', () => uow.read.leases.prune(new Date(now.getTime() - LEASES_RETAIN_MS))],
  ];
  for (const [step, run] of steps) {
    try { const count = await run(); if (count) logger.info('resource ledger maintenance', { step, count }); }
    catch (error) { logger.warn('resource ledger maintenance failed', { step, error: String(error) }); }
  }
}
