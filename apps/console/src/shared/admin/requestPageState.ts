import { parseRequestSearch } from './managementSearch';
import type { RequestSearch, RequestStatus } from './managementSearch';

interface RequestFact { readonly id: string; readonly projectId: string; readonly state: string; readonly project?: { readonly id: string } }
export interface RequestPageScope { readonly projectId?: string; readonly state: RequestStatus; readonly cursor?: string }
export interface RequestReviewPageProps extends RequestPageScope {
  readonly active: boolean; readonly onPage: (cursor?: string) => void; readonly onDirtyChange: (dirty: boolean) => void;
}

/** 草稿绑定在查询范围上：改项目、状态或翻页才换范围，其余导航保留输入。 */
export function requestScopeKey(search: RequestSearch) {
  return JSON.stringify([search.projectId, search.state, search.apiCursor, search.accessCursor]);
}
export function keepRequestDrafts(current: { pathname: string; search: object }, next: { pathname: string; search: object }) {
  return current.pathname === '/admin/requests' && next.pathname === current.pathname &&
    requestScopeKey(parseRequestSearch(current.search as Record<string, unknown>)) === requestScopeKey(parseRequestSearch(next.search as Record<string, unknown>));
}

/** 非法、错范围或重复申请作为读取错误，不能显示成可审批的当前页。 */
export function checkRequestPage<T extends { items: RequestFact[]; nextCursor?: string }>(page: T, scope: RequestPageScope, message: string): T {
  if (page.items.length > 20 || new Set(page.items.map((r) => r.id)).size !== page.items.length ||
    page.items.some((r) => !r.id || (scope.projectId && r.projectId !== scope.projectId) || (scope.state !== 'all' && r.state !== scope.state) || (r.project && r.project.id !== r.projectId)) ||
    (scope.cursor && page.nextCursor === scope.cursor)) throw new Error(message);
  return page;
}
