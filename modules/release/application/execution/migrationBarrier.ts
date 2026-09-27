import { migrationRecovery } from './migrationRecovery';
import { precondition } from '@crewstation/kernel';
import type { Release } from '../../domain/release';
import type { ReleaseUseCaseDeps } from '../dependencies';

/** Checked before creating a migration Job and again before its credentials are rendered. */
export async function migrationWriteBarrier(deps: Pick<ReleaseUseCaseDeps, 'uow' | 'executionHandoff' | 'maintenance' | 'services'>, release: Release): Promise<{ ready: boolean; message?: string }> {
  if (!release.manifest?.spec.release.migration.destructive || !release.manifest.spec.release.migrationCommand) return { ready: true };
  const slots = await deps.uow.read.slots.get(release.serviceId), currentId = slots?.[slots.active].releaseId;
  const current = currentId ? await deps.uow.read.releases.getById(currentId) : undefined;
  const controlled = [current, release].some((value) => value?.manifest?.kind === 'DigitalWorker' && value.manifest.spec.tasks?.executionControl === 'fenced');
  if (!controlled) return { ready: true };
  if (!await deps.maintenance.open(release.serviceId)) throw precondition('破坏性迁移要求持续开启维护窗口');
  if (!deps.executionHandoff?.migrationBarrier || !deps.executionHandoff.observeWritersStopped) throw precondition('迁移停写证明端口尚未配置');
  // There is no application writer to attest on an entirely new service. Any existing preview invalidates this shortcut.
  if (!currentId && [slots?.blue.releaseId, slots?.green.releaseId].every((id) => !id || id === release.id)) {
    return await deps.executionHandoff.observeWritersStopped(release.serviceId, true) ? { ready: true } : { ready: false, message: '等待所有业务执行进程停止' };
  }
  if (!currentId) throw precondition('没有可确认停写的正式版本，不能执行破坏性迁移');
  const recovery = await migrationRecovery(deps, release);
  if (!recovery.ready) return recovery;
  const result = await deps.executionHandoff.migrationBarrier(release.serviceId, { operationId: release.id, targetReleaseId: release.id, expectedActiveReleaseId: currentId, ...(recovery.supersedesOperationId ? { supersedesOperationId: recovery.supersedesOperationId } : {}) });
  if (!result.ready) return { ready: false, message: `等待迁移停写证明：${result.blocked.join('、')}` };
  if (!await deps.executionHandoff.observeWritersStopped(release.serviceId)) return { ready: false, message: '等待所有业务执行 Pod 确认停止' };
  return { ready: true };
}
