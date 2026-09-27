import { migrationBarrier } from './migrationBarrier';
import { precondition } from '@crewstation/kernel';
import type { BusinessReleaseHandoff, ReleaseHandoffSnapshot } from '../api/releaseHandoff';
import type { ControlSnapshot } from '../ports/executionControl';
import type { BusinessExecutionDeps } from './execution/dependencies';

export function releaseHandoffUseCases(deps: BusinessExecutionDeps): BusinessReleaseHandoff {
  const snapshot = (value: ControlSnapshot, quiescent: boolean): ReleaseHandoffSnapshot => {
    const control = value.control, handoff = control?.handoff;
    return { ...(control?.migration ? { migration: { operationId: control.migration.operationId, targetReleaseId: control.migration.targetReleaseId, expectedActiveReleaseId: control.migration.expectedActiveReleaseId } } : {}), epoch: control?.epoch ?? 1, stage: handoff?.stage ?? 'inactive', quiescent,
      ...(handoff ? { operationId: handoff.operationId, targetReleaseId: handoff.targetReleaseId, targetSlot: handoff.targetSlot } : {}),
      ...(control?.preparationDigest ? { preparationDigest: control.preparationDigest } : {}) };
  };
  const precheck: BusinessReleaseHandoff['precheck'] = async (serviceId, targetReleaseId) => {
    const registration = await deps.uow.read.contracts.forRelease(serviceId, targetReleaseId);
    if (registration?.tasksSpec?.executionControl !== 'fenced') throw precondition('交接目标未登记 fenced 任务契约', { code: 'release_contract_missing' });
    const accepted = registration.tasksSpec.acceptedTaskContractVersions ?? [];
    const blocked = (await deps.controls.activeTaskContracts(serviceId)).filter((task) => !accepted.includes(task.taskContractVersion));
    return { supported: blocked.length === 0, blocked };
  };
  return {
    ...migrationBarrier(deps),
    precheck,
    freeze: async (serviceId, request) => {
      if (request.expectedActiveReleaseId && !await deps.uow.read.contracts.forRelease(serviceId, request.expectedActiveReleaseId)) throw precondition('交接来源发布不属于该服务', { code: 'release_contract_missing' });
      const compatibility = await precheck(serviceId, request.targetReleaseId);
      if (!compatibility.supported) throw precondition('目标不支持仍需接管的任务契约', { code: 'task_contract_unsupported', blocked: compatibility.blocked });
      const value = await deps.controls.freeze(serviceId, request); return snapshot(value, value.quiescent);
    },
    inspect: async (serviceId) => snapshot(await deps.controls.read(serviceId), await deps.controls.quiescent(serviceId)),
    routeObserved: async (serviceId, request) => {
      const value = await deps.controls.routeObserved(serviceId, request.operationId, request.targetReleaseId, request.targetSlot);
      return snapshot(value, await deps.controls.quiescent(serviceId));
    },
  };
}
