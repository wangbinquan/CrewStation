import type { ReleaseId, ReleaseJourneyEvent, ServiceId } from '@crewstation/contracts';
import type { JourneyPatch, JourneyTransition, ReleaseJourney } from '../domain/journey/journey';

export interface JourneyCursor { at: string; id: string; recordKind: 'journey' | 'legacy' }
export interface JourneyRepository {
  insert(journey: ReleaseJourney): Promise<void>;
  get(id: string): Promise<ReleaseJourney | undefined>;
  snapshot(id: string): Promise<{ journey: ReleaseJourney; events: ReleaseJourneyEvent[] } | undefined>;
  events(id: string): Promise<ReleaseJourneyEvent[]>;
  /** Caller must be inside the original UOW. Locks the journey and compares the producer key before appending. */
  append(id: string, transition: JourneyTransition, patch?: JourneyPatch): Promise<ReleaseJourney>;
  byRelease(id: ReleaseId): Promise<ReleaseJourney[]>;
  bySwitchKey(serviceId: ServiceId, requestKey: string): Promise<ReleaseJourney | undefined>;
  page(serviceId: ServiceId, limit: number, cursor?: JourneyCursor, tag?: string, filter?: 'active' | 'ended'): Promise<JourneyCursor[]>;
  pendingLaunches(limit: number, afterId?: string): Promise<ReleaseJourney[]>;
}
