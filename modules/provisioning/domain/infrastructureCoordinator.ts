import { DomainTopic, ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { ProjectId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import { infrastructureOriginReferences } from './infrastructureOrigins';
import type { InfrastructureOriginDocument } from './infrastructureOrigins';

export interface InfrastructureCoordinator { readonly operationId: string; readonly projectId: ProjectId }

/** Only the currently accepted original operation's control rows are retained until its atomic completion. */
export function isInfrastructureCoordinator(document: InfrastructureOriginDocument, coordinator: InfrastructureCoordinator): boolean {
  const operationId = ResourceIdSchema.parse(coordinator.operationId), projectId = ProjectIdSchema.parse(coordinator.projectId);
  if (document.channel === 'queue' ? document.name !== 'provisioning.project-deletion' : document.name !== DomainTopic.projectDeletionRequested) return false;
  const references = infrastructureOriginReferences(document);
  if (references.current.find((entry) => entry.kind === 'deletion')?.key !== operationId) return false;
  if (document.channel === 'event' && references.current.find((entry) => entry.kind === 'project')?.key !== projectId)
    throw precondition('原删除协调事件与项目归属不符');
  if (references.legacy.length && references.legacy.some((entry, index) => entry.key !== references.current[index]?.key || entry.kind !== references.current[index]?.kind))
    throw precondition('当前删除协调内容不能由不同历史操作替换');
  return true;
}
