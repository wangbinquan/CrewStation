import type { ReleaseJourneySummary } from '@crewstation/contracts';
import type { PublishIntent } from './storage';

/** A lost publish response can only resume a fully matching original acceptance. */
export function acceptedIntentMatches(journey: ReleaseJourneySummary, intent: PublishIntent, serviceId: string, projectId: string): boolean {
  const snapshot = journey.snapshot;
  return snapshot.kind === 'publish' && snapshot.serviceId === serviceId && snapshot.projectId === projectId && snapshot.tag === intent.tag
    && snapshot.commitSha === intent.commitSha && snapshot.branch === intent.branch && snapshot.actorUserId === intent.actorId
    && (snapshot.message ?? '') === intent.message.trim()
    && snapshot.source.kind === intent.source && (snapshot.source.kind !== 'session' || snapshot.source.taskId === intent.taskId);
}
