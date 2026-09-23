import type { QueryKey } from '@tanstack/react-query';

/** 键末位承载请求对象：resources／detail／page-usage 都按 `queryKeys.cluster(part, request)` 组装。 */
function requestOf(key: QueryKey): Record<string, unknown> {
  const last = key[key.length - 1];
  return typeof last === 'object' && last !== null ? last as Record<string, unknown> : {};
}

/**
 * 后台采集每 30 秒换一份快照（RFC-010 设计值），快照 id 进查询键。除 snapshotId 外条件一致时，
 * 让上一份数据留在页面上等新回执原地替换：否则列表与详情会整块卸载成「载入中」，
 * 滚动容器塌掉后位置回到顶部（2026-09-21 实机）。筛选、分页或目标变了仍按新查询重新载入。
 */
export function sameApartFromSnapshot(previousKey: QueryKey, request: Record<string, unknown>): boolean {
  return sameApartFrom(previousKey, request, ['snapshotId']);
}

/** 趋势的预设时间窗每分钟前移一次（2026-09-23 起不再有「请求刷新」按钮）：只有起止时间变了就留住上一份曲线，等新回执原地替换。 */
export function sameApartFromWindow(previousKey: QueryKey, request: Record<string, unknown>): boolean {
  return sameApartFrom(previousKey, request, ['from', 'to']);
}

function sameApartFrom(previousKey: QueryKey, request: Record<string, unknown>, ignored: readonly string[]): boolean {
  const previous = requestOf(previousKey);
  const names = [...new Set([...Object.keys(previous), ...Object.keys(request)])].filter((name) => !ignored.includes(name));
  return names.every((name) => JSON.stringify(previous[name]) === JSON.stringify(request[name]));
}

/** 用量随快照重算资源清单，清单本身会变；范围没变就保留上一份用量，不闪回「载入中」。 */
export function sameUsageScope(previousKey: QueryKey, request: { readonly scope: string; readonly projectId?: string }): boolean {
  const previous = requestOf(previousKey);
  return previous.scope === request.scope && previous.projectId === request.projectId;
}
