import type { Actor, ProjectDeletionTarget, ProjectId } from '@crewstation/contracts';
import { forbidden, notFound, precondition } from '@crewstation/kernel';
import type { DeletionLease, DeletionOperationRecord } from '../../domain/deletion/records';
import type { RepositoryScope } from '../../ports/unitOfWork';
import type { ProjectUseCaseDeps } from '../dependencies';
import { currentActor } from '../creation/eligibility';

export function adminDeletionWork<T>(deps: ProjectUseCaseDeps, actor: Actor, work: () => Promise<T>): Promise<T> {
  return deps.roleLock.run(actor.userId, async () => {
    if (!(await currentActor(deps, actor)).isAdmin) throw forbidden('只有管理员可以永久删除项目或读取清理材料');
    return work();
  });
}
export async function deletionScope(deps: ProjectUseCaseDeps, projectId: ProjectId, scope: RepositoryScope = deps.uow.read): Promise<ProjectDeletionTarget> {
  const project = await scope.projects.getById(projectId);
  if (!project) throw notFound('项目', projectId);
  const service = await scope.services.getByProject(projectId);
  return { id: project.id, slug: project.slug, name: project.name, namespace: project.namespace, kind: project.kind, state: project.state,
    revision: await scope.deletions.lifecycleRevision(projectId), ...(service ? { serviceId: service.id } : {}),
    prodHost: deps.hosts.prodHost(project.slug), previewHost: deps.hosts.previewHost(project.slug), serviceHost: deps.hosts.serviceHost(project.slug) };
}
export async function loadDeletion(scope: RepositoryScope, operationId: string, lock = false): Promise<DeletionOperationRecord> {
  const record = await scope.deletions.getOperation(operationId, lock);
  if (!record) throw notFound('项目删除操作', operationId); return record;
}
export async function leasedDeletion(scope: RepositoryScope, lease: DeletionLease, now: Date): Promise<DeletionOperationRecord> {
  const record = await loadDeletion(scope, lease.operationId, true);
  if (record.operation.state !== 'running' || record.leaseOwner !== lease.owner || record.generation !== lease.generation || !record.leaseUntil || record.leaseUntil <= now) {
    throw precondition('项目删除租约已失效', { operationId: lease.operationId });
  }
  return record;
}
export function deletionLeaseUntil(now: Date, seconds = 120): Date {
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 600) throw precondition('项目删除租期须在 5–600 秒之间');
  return new Date(now.getTime() + seconds * 1000);
}
