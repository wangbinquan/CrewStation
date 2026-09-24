import { ProjectIdSchema } from '@crewstation/contracts';
import { parseProjectDirectorySearch } from './projectDirectorySearch';
import type { ProjectDirectorySearch } from './projectDirectorySearch';

export type CapabilityTab = 'integrations' | 'api' | 'events';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'all';
export interface CapabilitySearch extends ProjectDirectorySearch { tab: CapabilityTab; projectId?: string; proxy?: string; operation?: string }
/**
 * RFC-018 下线出站申请后只剩 API 一类；旧链接上的 `tab`／`egressCursor` 被忽略，不报错也不空页。
 * 2026-09-24 起多了应用使用申请，各自分页：`apiCursor` 与 `accessCursor`。
 */
export interface RequestSearch { projectId?: string; state: RequestStatus; apiCursor?: string; accessCursor?: string }
const text = (value: unknown, limit: number) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f]/u.test(value) ? value : undefined;

export function parseCapabilitySearch(search: Record<string, unknown>): CapabilitySearch {
  const tab = search.tab === 'api' || search.tab === 'events' ? search.tab : 'integrations';
  if (tab === 'integrations') return { tab, ...parseProjectDirectorySearch(search, true) };
  if (tab !== 'api') return { tab };
  const directory = parseProjectDirectorySearch(search);
  return { tab, projectId: ProjectIdSchema.safeParse(search.projectId).data, proxy: text(search.proxy, 80), operation: text(search.operation, 2048),
    ...(directory.q ? { q: directory.q } : {}), ...(directory.cursor ? { cursor: directory.cursor } : {}) };
}

export function parseRequestSearch(search: Record<string, unknown>): RequestSearch {
  const apiCursor = text(search.apiCursor, 2048), accessCursor = text(search.accessCursor, 2048);
  return { projectId: ProjectIdSchema.safeParse(search.projectId).data,
    state: search.state === 'all' || search.state === 'approved' || search.state === 'rejected' ? search.state : 'pending',
    ...(apiCursor ? { apiCursor } : {}), ...(accessCursor ? { accessCursor } : {}) };
}
