import { TaskIdSchema } from '@crewstation/contracts';
import type { DevelopmentObservationOwner, DevelopmentObservationSession } from '../ports/developmentObservations';

/** Explicit original-source composition. Reading a page grants no projection or ACK. */
export function developmentObservationSource(owner: DevelopmentObservationOwner, session: DevelopmentObservationSession) {
  return {
    next: () => session.nextDevelopmentUsageSource(),
    registration: async (key: Parameters<DevelopmentObservationOwner['resolve']>[0]) => (await session.getDevelopmentUsage(TaskIdSchema.parse(key.executionId), key))?.registration,
    resolve: (key: Parameters<DevelopmentObservationOwner['resolve']>[0]) => owner.resolve(key),
    nativePage: (key: Parameters<DevelopmentObservationOwner['resolve']>[0], passId: string, ordinal: string) => session.readDevelopmentNativePage(key, passId, ordinal),
    acknowledge: (key: Parameters<DevelopmentObservationOwner['resolve']>[0], through: number) => session.acknowledgeDevelopmentUsageSource(key, through),
  };
}
