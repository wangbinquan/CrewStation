import type { Clock, Logger } from '@crewstation/kernel';
import type { LedgerUnitOfWork } from '../ports/repositories';
import { commitRecord } from './commit';

/** 已结束的记录保留 7 天后压缩；变更日志保留 24 小时（设计 §8.3，提案 Q5）。 */
export const COMPACT_AFTER_MS = 7 * 24 * 3_600_000;
export const CHANGES_RETAIN_MS = 24 * 3_600_000;
const LEASES_RETAIN_MS = 3_600_000;
const BATCH = 100;

export const RETENTION_EXPIRED = { code: 'retention-expired', message: '失败保留期已满，平台自动回收' } as const;

/**
 * 保留期到了的失败记录转成「不要了」（设计 §6.4）：这是资源中心唯一替所属模块改期望的地方，
 * 原因码固定为 retention-expired；其后的回收与平常释放一样由调和器按阶段执行。
 */
export async function expireRetention(uow: LedgerUnitOfWork, clock: Clock): Promise<number> {
  const due = await uow.read.records.retentionDue(BATCH);
  let expired = 0;
  for (const candidate of due) {
    expired += await uow.run(async (scope) => {
      const record = await scope.records.get(candidate.id, { forUpdate: true });
      if (!record || record.desired === 'absent' || record.phase !== 'failed' || !record.retainUntil) return 0;
      await commitRecord(scope, record, { ...record, desired: 'absent', generation: record.generation + 1, releaseReason: RETENTION_EXPIRED }, clock.now());
      return 1;
    });
  }
  return expired;
}

export async function compactStopped(uow: LedgerUnitOfWork, clock: Clock): Promise<number> {
  const now = clock.now();
  const ids = await uow.read.records.compactable(new Date(now.getTime() - COMPACT_AFTER_MS), BATCH);
  let compacted = 0;
  for (const id of ids) {
    compacted += await uow.run(async (scope) => {
      const record = await scope.records.compact(id, now);
      if (!record) return 0;
      await scope.changes.append({ ...(record.projectId ? { projectId: record.projectId } : {}), resourceId: record.id, version: record.version, change: 'remove' });
      return 1;
    });
  }
  return compacted;
}

/** 一轮维护：保留期、压缩、变更日志与租约清理。任何一步失败只记日志，下一轮再来。 */
export async function maintainLedger(uow: LedgerUnitOfWork, clock: Clock, logger: Logger): Promise<void> {
  const now = clock.now();
  const steps: [string, () => Promise<number>][] = [
    ['retention', () => expireRetention(uow, clock)],
    ['compaction', () => compactStopped(uow, clock)],
    ['changes', () => uow.read.changes.pruneBefore(new Date(now.getTime() - CHANGES_RETAIN_MS))],
    ['leases', () => uow.read.leases.prune(new Date(now.getTime() - LEASES_RETAIN_MS))],
  ];
  for (const [step, run] of steps) {
    try {
      const count = await run();
      if (count) logger.info('resource ledger maintenance', { step, count });
    } catch (error) {
      logger.warn('resource ledger maintenance failed', { step, error: String(error) });
    }
  }
}
