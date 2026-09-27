import { requestMigrationStop } from './migrationStopRequest';
import type { Release } from '../../domain/release';
import type { ReleaseUseCaseDeps } from '../dependencies';

/** A newly published correction may replace a failed migration, never infer safety from a timeout. */
export async function migrationRecovery(deps: Pick<ReleaseUseCaseDeps, 'uow' | 'executionHandoff' | 'services'>, target: Release): Promise<{ ready: boolean; supersedesOperationId?: string; message?: string }> {
  const handoff = deps.executionHandoff!;
  const migration = (await handoff.inspect(target.serviceId)).migration;
  if (!migration || migration.operationId === target.id) return { ready: true };
  const prior = await deps.uow.read.releases.getById(migration.targetReleaseId);
  if (!prior || prior.serviceId !== target.serviceId || prior.status !== 'failed' || target.createdAt <= prior.createdAt) return { ready: false, message: '原迁移尚未失败或修复版本不更新，保持停写屏障' };
  // A domain timeout/Created=false is not a stop proof. Finished or Stopped is written by cluster observation.
  const record = await deps.uow.read.ledger?.jobRecord(prior.id, 'migration-job');
  if (!record?.conditions.some((c) => ['Finished', 'Stopped'].includes(c.type) && c.status === 'true')) {
    await requestMigrationStop(deps, prior);
    return { ready: false, message: '等待原迁移 Job 的持久终止证明；超时或查无记录不能接替迁移' };
  }
  if (!handoff.observeMigrationStopped || !await handoff.observeMigrationStopped(target.serviceId, prior.id, !record.conditions.some((c) => c.type === 'Finished' && c.status === 'true'))) return { ready: false, message: '等待原迁移 Pod 确认清理，保持停写屏障' };
  return { ready: true, supersedesOperationId: migration.operationId };
}
