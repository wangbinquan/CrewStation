import type { BusinessMigrationReady } from '@crewstation/contracts';
import { conflict, forbidden, precondition } from '@crewstation/kernel';
import type { ExecutionAuthority, ExecutionControl, MigrationFreeze } from './executionControl';
import { nextEpoch } from './executionControl';

/** Frozen authority survives process restarts and never expires back into a running lease. */
export function freezeMigration(current: ExecutionControl, request: Omit<MigrationFreeze, 'preparationDigest' | 'receiptPodUid'> & { supersedesOperationId?: string }): ExecutionControl {
  if (current.migration?.operationId === request.operationId) {
    if (current.migration.targetReleaseId !== request.targetReleaseId || current.migration.expectedActiveReleaseId !== request.expectedActiveReleaseId) throw conflict('迁移操作已用于不同发布');
    return current;
  }
  if (current.handoff && current.handoff.stage !== 'complete') throw precondition('执行交接尚未完成');
  if (current.activeReleaseId !== request.expectedActiveReleaseId) throw conflict('迁移来源发布已变化');
  if (current.migration && (current.phase !== 'frozen' || request.supersedesOperationId !== current.migration.operationId)) throw precondition('已有迁移停写屏障，必须先证明原迁移停止');
  if (!current.migration && request.supersedesOperationId) throw conflict('被接替的迁移屏障已变化');
  const { supersedesOperationId: _prior, ...next } = request;
  // Retain the proven application stop barrier: recovery advances epoch but never re-enables old writers.
  const migration = { ...next, ...(current.migration?.preparationDigest ? { preparationDigest: current.migration.preparationDigest, receiptPodUid: current.migration.receiptPodUid } : {}) };
  return { ...current, migration, epoch: nextEpoch(current.epoch), phase: 'frozen', leaseId: null, leaseOwner: null, leasePodUid: null, leaseExpiresAt: null, preparationDigest: null };
}
/** Receipt attests an application database write barrier; browser claims cannot substitute for it. */
export function migrationReady(current: ExecutionControl, source: ExecutionAuthority, input: BusinessMigrationReady): ExecutionControl {
  const migration = current.migration;
  if (!migration || migration.operationId !== input.operationId || current.epoch !== input.expectedEpoch) throw conflict('迁移屏障操作或世代已变化', { code: 'stale_generation' });
  if (current.phase !== 'frozen' || !source.ready || source.releaseId !== migration.expectedActiveReleaseId || source.physicalSlot !== current.physicalSlot) throw forbidden('迁移停写回执必须来自当前正式发布的可信 Pod');
  if (migration.preparationDigest && migration.preparationDigest !== input.preparationDigest) throw conflict('迁移停写回执与原内容不同');
  return { ...current, migration: { ...migration, preparationDigest: input.preparationDigest, receiptPodUid: source.podUid } };
}
