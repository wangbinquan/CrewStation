import type { BlockedEgressDto, EgressEntryDto, EgressRequestDto } from '@crewstation/contracts';
import type { BlockedRecord } from '../domain/blockedRecord';
import type { EgressEntry } from '../domain/egressEntry';
import type { EgressRequest } from '../domain/egressRequest';

export function entryToDto(entry: EgressEntry): EgressEntryDto {
  return {
    id: entry.id, fqdn: entry.fqdn, scope: entry.scope, createdBy: entry.createdBy, createdAt: entry.createdAt.toISOString(),
    ...(entry.projectId ? { projectId: entry.projectId } : {}),
    ...(entry.note ? { note: entry.note } : {}),
  };
}

export function requestToDto(request: EgressRequest): EgressRequestDto {
  return {
    id: request.id, projectId: request.projectId, fqdn: request.fqdn, state: request.state, requestedBy: request.requestedBy, createdAt: request.createdAt.toISOString(),
    ...(request.reason ? { reason: request.reason } : {}),
    ...(request.decidedBy ? { decidedBy: request.decidedBy } : {}),
    ...(request.decision ? { decision: request.decision } : {}),
    ...(request.decidedAt ? { decidedAt: request.decidedAt.toISOString() } : {}),
  };
}

export function blockedToDto(record: BlockedRecord): BlockedEgressDto {
  return { projectId: record.projectId, fqdn: record.fqdn, count: record.count, lastSeenAt: record.lastSeenAt.toISOString(), ...(record.source ? { source: record.source } : {}) };
}
