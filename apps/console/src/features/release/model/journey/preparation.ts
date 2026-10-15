import type { ReleaseJourneySummary } from '@crewstation/contracts';
import { ReleaseDtoSchema, ReleaseJourneyPageSchema } from '@crewstation/contracts';
import type { PublishDevSessionInput } from '@crewstation/api-client';
import { api } from '../../../../shared/api/client';
import type { PublishIntent } from './storage';

/** A lost publish response can only resume a fully matching original acceptance. */
export function acceptedIntentMatches(journey: ReleaseJourneySummary, intent: PublishIntent, serviceId: string, projectId: string): boolean {
  const snapshot = journey.snapshot;
  return snapshot.kind === 'publish' && snapshot.serviceId === serviceId && snapshot.projectId === projectId && snapshot.tag === intent.tag
    && snapshot.commitSha === intent.commitSha && snapshot.branch === intent.branch && snapshot.actorUserId === intent.actorId
    && (snapshot.message ?? '') === intent.message.trim()
    && snapshot.source.kind === intent.source && (snapshot.source.kind !== 'session' || snapshot.source.taskId === intent.taskId);
}

export async function findAcceptedPublish(intent: PublishIntent, serviceId: string, projectId: string): Promise<{ journeyId?: string; canResend: boolean }> {
  let cursor: string | undefined, hasRecord = false;
  do {
    const page = ReleaseJourneyPageSchema.parse(await api.services.listReleaseJourneys(serviceId, { tag: intent.tag, limit: 50, cursor }));
    const match = page.items.find(item => item.recordKind === 'journey' && acceptedIntentMatches(item, intent, serviceId, projectId));
    if (match?.recordKind === 'journey') return { journeyId: match.id, canResend: false };
    hasRecord ||= page.items.length > 0; cursor = page.nextCursor;
  } while (cursor);
  const tags = await api.services.listTags(serviceId);
  return { canResend: !hasRecord && !tags.items.some(tag => tag.name === intent.tag) };
}

export async function sendPublishIntent(intent: PublishIntent, serviceId: string, projectId: string) {
  const request: PublishDevSessionInput = { version: intent.tag, branch: intent.branch, expectedCommitSha: intent.commitSha, ...(intent.taskId ? { expectedTaskId: intent.taskId } : {}), ...(intent.message.trim() ? { message: intent.message.trim() } : {}) };
  return ReleaseDtoSchema.parse(await (intent.source === 'session' ? api.devSession.publish(projectId, request) : api.services.publish(serviceId, request)));
}
