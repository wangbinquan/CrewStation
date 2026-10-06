import { DomainPayloadSchemas } from '@crewstation/contracts';
import type { DomainTopicName, ProjectDeletionTarget } from '@crewstation/contracts';
import { z } from 'zod';
import { infrastructureOriginReferences } from './infrastructureOrigins';
import type { InfrastructureOriginDocument } from './infrastructureOrigins';

export const retainableQueueKinds = ['agent-runtime.profile-test', 'project.provision', 'release.pipeline'] as const;
const eventNames = new Set(['project.created', 'project.archived', 'release.registered', 'release.status-changed']);
export const retainableDocument = (document: InfrastructureOriginDocument) => document.channel === 'queue'
  ? retainableQueueKinds.some(kind => kind === document.name) : eventNames.has(document.name);

/** A missing owner never relaxes the original document or migration-provenance contract. */
export function retentionReferences(document: InfrastructureOriginDocument) {
  const references = infrastructureOriginReferences(document);
  if (document.legacyPayload !== null && document.legacyPayload !== undefined) {
    const field = document.name === 'agent-runtime.profile-test' ? 'testId' : document.name === 'project.provision' ? 'projectId' : 'releaseId';
    const key = z.string().min(1).refine(value => value.trim().length > 0);
    const fields = Object.fromEntries(references.current.map(ref => [ref.kind === 'project' ? 'projectId' : ref.kind === 'service' ? 'serviceId' : 'releaseId', key]));
    if (document.channel === 'queue') z.object({ [field]: key }).strict().parse(document.legacyPayload);
    else DomainPayloadSchemas[document.name as DomainTopicName].extend(fields).strict().parse(document.legacyPayload);
  }
  return references;
}

/** Check the whole original body, including nested manifest, error-context values and object keys. */
export function hasRetentionTarget(value: unknown, target: ProjectDeletionTarget): boolean {
  if (typeof value === 'string') {
    const identities = [target.id, target.serviceId, target.namespace, target.prodHost, target.previewHost, target.serviceHost].filter((v): v is string => !!v);
    return identities.some(id => value.includes(id)) || value === target.slug ||
      [target.slug + '.', target.slug + '/', '/' + target.slug, 'cs-' + target.slug, target.slug + '-'].some(id => value.includes(id));
  }
  if (Array.isArray(value)) return value.some(entry => hasRetentionTarget(entry, target));
  return !!value && typeof value === 'object' && Object.entries(value).some(([key, entry]) => hasRetentionTarget(key, target) || hasRetentionTarget(entry, target));
}
