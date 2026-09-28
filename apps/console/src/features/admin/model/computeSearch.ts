import { ResourceIdSchema } from '@crewstation/contracts';

/** /admin/compute 的查询串：profile 打开某个档位的编辑页，create 打开新建页；缺省是档位列表（RFC-006 只有一张表）。 */
export interface ComputeSearch { tab?: 'pricing'; profile?: string; create?: true; q?: string }

export function parseComputeSearch(raw: Record<string, unknown>): ComputeSearch {
  const q = typeof raw.q === 'string' ? raw.q.trim().slice(0, 120) : '';
  const filter = q ? { q } : {};
  if (raw.tab === 'pricing') return { ...filter, tab: 'pricing' };
  const profile = ResourceIdSchema.safeParse(raw.profile).data;
  if (profile !== undefined) return { ...filter, profile };
  return raw.create === true || raw.create === 'true' || raw.create === '1' || raw.create === 1 ? { ...filter, create: true } : filter;
}
