import type { BusinessCapabilitiesDto, ServiceId } from '@crewstation/contracts';
import type { BusinessExecutionDeps } from '../execution/dependencies';
import type { FinalizationPreparation } from '../../ports/storage/preparation';

export function completeFinalizationPorts(ports: FinalizationPreparation | undefined): boolean {
  return !!(ports?.preflight && ports.operatorArchive?.preflight && ports.operatorArchive.assessLoss && ports.operatorArchive.confirmLoss && ports.operatorArchive.deleteArtifacts
    && ports.archive.permitDeletion && ports.archive.reclaimed && ports.archive.revise && ports.runtime.storageCleanup && ports.runtime.resolveBusinessStorage && ports.runtime.archiveExecution?.stop);
}
export async function taskStorageCapabilities(deps: Pick<BusinessExecutionDeps, 'storageStatus' | 'taskInputs'>, serviceId: ServiceId): Promise<NonNullable<BusinessCapabilitiesDto['storage']>> {
  const status = await deps.storageStatus?.(serviceId) ?? { available: false, reason: 'finalization_unavailable' };
  return { version: 1, objects: status.available, taskInputs: status.available && !!deps.taskInputs, finalization: status.available, unavailableReason: status.reason };
}
