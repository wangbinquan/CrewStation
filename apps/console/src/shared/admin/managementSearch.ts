import { ProjectIdSchema } from '@crewstation/contracts';
import { parseProjectDirectorySearch } from './projectDirectorySearch';
import type { ProjectDirectorySearch } from './projectDirectorySearch';

export type CapabilityTab = 'integrations' | 'api' | 'events';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'all';
export interface CapabilitySearch extends ProjectDirectorySearch { tab: CapabilityTab; projectId?: string; proxy?: string; operation?: string }
export interface RequestSearch { tab: 'api' | 'egress'; projectId?: string; state: RequestStatus; apiCursor?: string; egressCursor?: string }
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
  const apiCursor = text(search.apiCursor, 2048), egressCursor = text(search.egressCursor, 2048);
  return { tab: search.tab === 'egress' ? 'egress' : 'api', projectId: ProjectIdSchema.safeParse(search.projectId).data,
    state: search.state === 'all' || search.state === 'approved' || search.state === 'rejected' ? search.state : 'pending',
    ...(apiCursor ? { apiCursor } : {}), ...(egressCursor ? { egressCursor } : {}) };
}
