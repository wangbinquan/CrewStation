import { SlugSchema } from '@crewstation/contracts';

/** /admin/compute 的查询串：profile 打开某个档位的编辑页，create 打开新建页；缺省是档位列表（RFC-006 只有一张表）。 */
export interface ComputeSearch { profile?: string; create?: true }

export function parseComputeSearch(raw: Record<string, unknown>): ComputeSearch {
  const profile = SlugSchema.safeParse(raw.profile).data;
  if (profile !== undefined) return { profile };
  return raw.create === true || raw.create === 'true' || raw.create === '1' || raw.create === 1 ? { create: true } : {};
}
