import { RuntimeConfigIdSchema } from '@crewstation/contracts';

export type ComputeTab = 'profiles' | 'runtime';
export interface ComputeSearch { tab: ComputeTab; config?: string }

/** /admin/compute 的查询串：带 config 即打开某个运行环境的编辑页；缺省落在算力档位页签。 */
export function parseComputeSearch(raw: Record<string, unknown>): ComputeSearch {
  const config = RuntimeConfigIdSchema.safeParse(raw.config).data;
  return { tab: raw.tab === 'runtime' || config !== undefined ? 'runtime' : 'profiles', ...(config === undefined ? {} : { config }) };
}
