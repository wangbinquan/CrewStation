import { jsonHash } from '@crewstation/kernel';
import type { FinalizationOperation } from '../../../domain/finalization/operation';
import type { BusinessProjectWork } from '../../../ports/deletion/work';
import type { FinalizationPreparation } from '../../../ports/storage/preparation';
import { guardedBusinessPort } from './projectWork';

export function finalizationWork<T>(work: BusinessProjectWork | undefined, operation: FinalizationOperation, stage: string, callback: () => Promise<T>): Promise<T> {
  return work ? work.run({ projectId: operation.projectId, serviceId: operation.serviceId, kind: 'lifecycle', reference: operation.id,
    inputDigest: jsonHash({ stage, id: operation.id, revision: operation.view.revision, sequence: operation.sequence }) }, callback) : callback();
}
export function scopedFinalizationPorts(ports: FinalizationPreparation | undefined, work: BusinessProjectWork | undefined) {
  if (!ports || !work) return ports;
  const runtime = { ...guardedBusinessPort(ports.runtime, work, true),
    ...(ports.runtime.archiveExecution ? { archiveExecution: guardedBusinessPort(ports.runtime.archiveExecution, work, true) } : {}),
    ...(ports.runtime.storageCleanup ? { storageCleanup: guardedBusinessPort(ports.runtime.storageCleanup, work, true) } : {}),
  };
  return { ...guardedBusinessPort(ports, work, true), runtime, archive: guardedBusinessPort(ports.archive, work, true),
    ...(ports.operatorArchive ? { operatorArchive: guardedBusinessPort(ports.operatorArchive, work, true) } : {}),
  };
}
