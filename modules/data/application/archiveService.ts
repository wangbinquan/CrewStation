import { OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';
import type { TaskId } from '@crewstation/contracts';
import { conflict, forbidden, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { ArchiveServiceApi } from '../api/archiveServiceApi';
import type { ObjectServiceCaller } from '../api/objectServiceApi';
import type { ArchivePlanRecord } from '../domain/objectStorage';
import type { ArchivePlanRepository } from '../ports/archivePlans';
import type { ArchiveTaskDirectory } from '../ports/archiveTasks';
import type { ObjectSourceResolver } from '../ports/objectSources';
import type { ObjectCatalogRepository } from '../ports/objectStorage';

export interface ArchiveServiceDeps { plans: ArchivePlanRepository; tasks: ArchiveTaskDirectory; sources: ObjectSourceResolver; catalog: ObjectCatalogRepository }
const dto = (p: ArchivePlanRecord) => ({ id: p.id, taskId: p.taskId, revision: p.revision, state: p.state, digest: p.digest, itemCount: p.itemCount, byteCount: p.byteCount, createdAt: p.createdAt });
export function archiveService(deps: ArchiveServiceDeps): ArchiveServiceApi {
  const service = async (caller: ObjectServiceCaller) => {
    const source = await deps.sources.resolve(caller);
    if (!source || source.env !== 'production') throw forbidden('需要已声明对象存储的正式服务身份');
    const space = await deps.catalog.serviceSpace(source.serviceId, source.env);
    if (!space || space.projectId !== source.projectId) throw precondition('服务对象空间尚未供给');
    return { source, space };
  };
  const requireTask = async (context: Awaited<ReturnType<typeof service>>, taskId: TaskId) => {
    const task = await deps.tasks.read(context.source.serviceId, taskId);
    if (!task || task.projectId !== context.source.projectId) throw notFound('业务任务');
    if (task.completionPolicy !== 'archive-and-delete') throw precondition('此任务没有启用归档终结策略', { code: 'finalization_policy_required' });
  };
  const owned = async (caller: ObjectServiceCaller, id: string) => {
    const context = await service(caller);
    const plan = await deps.plans.get(id);
    if (!plan || plan.spaceId !== context.space.id) throw notFound('归档清单');
    await requireTask(context, plan.taskId);
    return { ...context, plan };
  };
  return {
    preflight: async (caller, taskId, archive) => {
      const context = await service(caller); await requireTask(context, taskId);
      if ('planId' in archive) {
        const plan = await deps.plans.get(archive.planId);
        if (!plan || plan.spaceId !== context.space.id || plan.taskId !== taskId) throw notFound('归档清单');
        if (plan.state !== 'sealed' || plan.revision !== archive.planRevision || plan.digest !== archive.digest) throw conflict('归档清单必须封存且修订与摘要一致', { code: 'storage_revision_conflict' });
      }
      return { spaceId: context.space.id };
    },
    create: async (caller, taskId, input) => { const context = await service(caller); await requireTask(context, taskId); return dto(await deps.plans.create(context.space.id, taskId, newResourceId(), input.requestKey, { source: context.source, fence: input.fence })); },
    get: async (caller, id) => dto((await owned(caller, id)).plan),
    append: async (caller, id, input) => { const { source } = await owned(caller, id); return dto(await deps.plans.append(id, input, { source, fence: input.fence })); },
    seal: async (caller, id, input) => { const { source } = await owned(caller, id); return dto(await deps.plans.seal(id, input.requestKey, input.expectedRevision, { source, fence: input.fence })); },
    abort: async (caller, id, input) => { const { source } = await owned(caller, id); return dto(await deps.plans.abort(id, input.expectedRevision, { source, fence: input.fence })); },
    entries: async (caller, id, query) => {
      const { plan } = await owned(caller, id);
      if (plan.revision !== query.expectedRevision) throw conflict('归档清单修订已变化', { code: 'storage_revision_conflict' });
      const items = []; let bytes = 1024;
      for (const entry of plan.entries.slice(query.offset, query.offset + query.limit)) {
        const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
        if (bytes + size > OBJECT_STORAGE_LIMITS.pageBytes) break;
        items.push(entry); bytes += size;
      }
      const offset = query.offset + items.length;
      return { revision: plan.revision, items, nextOffset: offset < plan.entries.length ? offset : null };
    },
  };
}
