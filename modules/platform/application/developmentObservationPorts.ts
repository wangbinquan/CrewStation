import { TaskIdSchema } from '@crewstation/contracts';
import type { DevelopmentObservationOwner, DevelopmentObservationSession } from '../ports/developmentObservations';

/** Explicit composition participant. Production wiring keeps this source disconnected. */
export function developmentObservationSource(owner: DevelopmentObservationOwner, session: DevelopmentObservationSession) {
  return {
    next: () => session.nextDevelopmentUsageSource(),
    registration: async (key: Parameters<DevelopmentObservationOwner['resolve']>[0]) => (await session.getDevelopmentUsage(TaskIdSchema.parse(key.executionId), key))?.registration,
    resolve: (key: Parameters<DevelopmentObservationOwner['resolve']>[0]) => owner.resolve(key),
    acknowledge: (key: Parameters<DevelopmentObservationOwner['resolve']>[0], through: number) => session.acknowledgeDevelopmentUsageSource(key, through),
  };
}
