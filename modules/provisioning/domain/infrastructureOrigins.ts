import { DomainPayloadSchemas, DomainTopic, ResourceIdSchema } from '@crewstation/contracts';
import type { DomainTopicName } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { z } from 'zod';

export type InfrastructureOriginKind = 'project' | 'service' | 'release' | 'task' | 'subtask' | 'delivery' | 'profile-test' | 'rebuild'
  | 'parent-ending' | 'cluster-refresh' | 'cluster-operation' | 'cluster-metrics' | 'cluster-storage' | 'resource-change' | 'deletion' | 'api-operation';
export interface InfrastructureOriginReference { readonly kind: InfrastructureOriginKind; readonly key: string }
export interface InfrastructureOriginDocument {
  readonly channel: 'queue' | 'event'; readonly name: string; readonly payload: unknown; readonly legacyPayload: unknown; readonly identityProvenance: unknown;
}
type Fields = Readonly<Record<string, InfrastructureOriginKind>>;
const queue: Readonly<Record<string, Fields>> = {
  'project.provision': { projectId:'project' }, 'events.deliver': { deliveryId:'delivery' }, 'release.pipeline': { releaseId:'release' },
  'agent-runtime.profile-test': { testId:'profile-test' }, 'task-runtime.rebuild': { requestId:'rebuild' },
  'task-runtime.native-execution': { taskId:'task' }, 'task-runtime.development-parent-ending': { endingId:'parent-ending' },
  'cluster-management.refresh': { requestId:'cluster-refresh' }, 'cluster-management.operation': { operationId:'cluster-operation' },
  'cluster-management.metrics': { requestId:'cluster-metrics' }, 'cluster-management.storage': { requestId:'cluster-storage' },
  'resource-access.apply': { changeId:'resource-change' }, 'provisioning.project-deletion': { operationId:'deletion' },
};
// Grant changes belong to the calling service; the referenced provider operation can belong to a different project.
const events: Readonly<Record<DomainTopicName, Fields>> = {
  [DomainTopic.projectCreated]: { projectId:'project' }, [DomainTopic.projectArchived]: { projectId:'project' },
  [DomainTopic.projectDeletionRequested]: { projectId:'project',operationId:'deletion' },
  [DomainTopic.releaseRegistered]: { projectId:'project',serviceId:'service',releaseId:'release' },
  [DomainTopic.releaseStatusChanged]: { serviceId:'service',releaseId:'release' },
  [DomainTopic.trafficSwitched]: { projectId:'project',serviceId:'service',releaseId:'release' },
  [DomainTopic.maintenanceChanged]: { projectId:'project',serviceId:'service' },
  [DomainTopic.taskCreated]: { projectId:'project',serviceId:'service',taskId:'task' },
  [DomainTopic.taskReleased]: { projectId:'project',taskId:'task' },
  [DomainTopic.subtaskFinished]: { taskId:'task',subtaskId:'subtask' },
  [DomainTopic.grantChanged]: { serviceId:'service' }, [DomainTopic.openPolicyChanged]: { operationId:'api-operation' },
  [DomainTopic.configChanged]: { projectId:'project' },
};
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const provenance = z.object({ version:z.literal('resource-identity/v1'),sourceColumn:z.literal('legacy_payload'),originalHash:hash,normalizedHash:hash }).strict();
const object = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw precondition('基础设施原内容不是完整对象');
  return raw as Record<string, unknown>;
};
function current(document: InfrastructureOriginDocument, fields: Fields) {
  if (document.channel === 'event') return object(DomainPayloadSchemas[document.name as DomainTopicName].strict().parse(document.payload));
  const shape: Record<string,z.ZodType> = Object.fromEntries(Object.keys(fields).map((key) => [key,ResourceIdSchema]));
  if (document.name === 'cluster-management.operation') shape.resumeCount = z.number().int().nonnegative().optional();
  return object(z.object(shape).strict().parse(document.payload));
}
const references = (body: Record<string,unknown>, fields: Fields): InfrastructureOriginReference[] => Object.entries(fields).map(([field,kind]) => {
  const key = body[field];
  if (typeof key !== 'string' || !key.length) throw precondition('基础设施原归属键不完整');
  return { kind,key };
});

/** Extracts source references only. Public owner ports must resolve every current/legacy key and establish complete original ownership. */
export function infrastructureOriginReferences(document: InfrastructureOriginDocument) {
  const registered = document.channel === 'queue' ? queue : document.channel === 'event' ? events : undefined;
  if (!registered || !Object.hasOwn(registered,document.name)) throw precondition('基础设施内容类型尚未登记，不能视为空范围');
  const fields = document.channel === 'queue' ? queue[document.name]! : events[document.name as DomainTopicName];
  const body = current(document,fields),original = references(body,fields);
  for (const reference of original) ResourceIdSchema.parse(reference.key);
  if (document.legacyPayload === null || document.legacyPayload === undefined) {
    if (document.identityProvenance !== null && document.identityProvenance !== undefined) throw precondition('基础设施历史来源缺少原内容');
    return { current:original,legacy:[] as InfrastructureOriginReference[] };
  }
  const source = provenance.parse(document.identityProvenance),legacy = object(document.legacyPayload);
  if (source.originalHash !== jsonHash(legacy) || source.normalizedHash !== jsonHash(document.payload)) throw precondition('基础设施原内容与迁移摘要不符');
  return { current:original,legacy:references(legacy,fields) };
}
