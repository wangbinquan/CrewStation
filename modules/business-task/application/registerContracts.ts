import type { DomainPayload, ReleaseId, ServiceId } from '@crewstation/contracts';
import type { BusinessTaskUseCaseDeps } from './dependencies';
import type { BusinessProjectWork } from '../ports/deletion/work';
import { jsonHash } from '@crewstation/kernel';

/** release.registered → 契约快照按发布版本落表（G4、AT-53）。 */
export function registerContractsUseCase(deps: Pick<BusinessTaskUseCaseDeps, 'uow' | 'clock'> & { projectWork?: BusinessProjectWork }) {
  return async (payload: DomainPayload<'release.registered'>): Promise<void> => {
    const tasks = payload.manifest.kind === 'DigitalWorker' ? payload.manifest.spec.tasks : undefined;
    const save = () => deps.uow.run((scope) => scope.contracts.save({
      ...(payload.executionMaterials ? { releaseMaterials: payload.executionMaterials } : {}),
      serviceId: payload.serviceId as ServiceId, releaseId: payload.releaseId as ReleaseId, tag: payload.tag,
      agentProfiles: tasks?.agentProfiles ?? [], outputContracts: tasks?.outputContracts ?? [], ...(tasks ? { tasksSpec: tasks } : {}), registeredAt: deps.clock.now(),
    }));
    if (deps.projectWork) await deps.projectWork.run({ projectId: payload.projectId, serviceId: payload.serviceId, kind: 'contract', reference: payload.releaseId, inputDigest: jsonHash(payload) }, save);
    else await save();
  };
}
