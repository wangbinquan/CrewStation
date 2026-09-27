import type { Actor, RuntimeImageHistoryQuery, RuntimeImageHistoryPage } from '@crewstation/contracts';
import { RuntimeImageHistoryQuerySchema } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import type { RuntimeImageDeps } from '../dependencies';
import { imageAccess } from '../access';

export function runtimeImageExecutionHistory(deps: RuntimeImageDeps) {
  return async (actor: Actor, projectId: string | undefined, imageId: string, query: RuntimeImageHistoryQuery): Promise<RuntimeImageHistoryPage> => {
    await imageAccess(deps, actor, projectId, imageId, 'view');
    const page = RuntimeImageHistoryQuerySchema.parse(query);
    const ids = await deps.uow.read.versions.ids(imageId);
    if (page.versionId && !ids.includes(page.versionId)) throw notFound('运行镜像版本', page.versionId);
    if (!deps.executionHistory) throw precondition('运行镜像使用记录查询尚未装配');
    const rows = await deps.executionHistory.list({ projectId, versionIds: page.versionId ? [page.versionId] : ids, before: page.before, limit: page.limit + 1 });
    const items = rows.slice(0, page.limit);
    return { items, ...(rows.length > page.limit ? { next: items.at(-1)!.id } : {}) };
  };
}
