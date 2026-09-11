import type { DomainPayload, ReleaseId, ServiceId } from '@crewstation/contracts';
import type { BusinessTaskUseCaseDeps } from './dependencies';

/** release.registered → 契约快照按发布版本落表（G4、AT-53）。 */
export function registerContractsUseCase(deps: BusinessTaskUseCaseDeps) {
  return async (payload: DomainPayload<'release.registered'>): Promise<void> => {
    const tasks = payload.manifest.kind === 'DigitalWorker' ? payload.manifest.spec.tasks : undefined;
    await deps.uow.run((scope) => scope.contracts.save({
      serviceId: payload.serviceId as ServiceId, releaseId: payload.releaseId as ReleaseId, tag: payload.tag,
      agentProfiles: tasks?.agentProfiles ?? [], outputContracts: tasks?.outputContracts ?? [], registeredAt: deps.clock.now(),
    }));
  };
}
