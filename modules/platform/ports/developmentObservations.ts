import type { DevelopmentUsageKey, DevelopmentUsageRegistration, DevelopmentUsagePage } from '@crewstation/contracts';
import type { ObservationDevelopmentAcceptedPrice } from './executionObservations';

/** Independent composition values, structurally checked against each owner's root API. */
export interface DevelopmentObservationOwner {
  resolve(key: DevelopmentUsageKey): Promise<{ registration: DevelopmentUsageRegistration; price: ObservationDevelopmentAcceptedPrice;
    nativeSelection?: { version: 1 | 2; expectedNamespace: string } } | undefined>;
}
export interface DevelopmentObservationSession {
  nextDevelopmentUsageSource(): Promise<DevelopmentUsagePage | undefined>;
  getDevelopmentUsage(taskId: DevelopmentUsageRegistration['runtimeTaskId'], key: DevelopmentUsageKey): Promise<{ registration: DevelopmentUsageRegistration } | undefined>;
  acknowledgeDevelopmentUsageSource(key: DevelopmentUsageKey, through: number): Promise<void>;
}
