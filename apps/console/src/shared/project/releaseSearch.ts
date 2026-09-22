import { searchText } from './settingsSearch';

export type PublishSource = 'session' | 'repository';
export interface ReleaseSearch { readonly source?: PublishSource; readonly release?: string; /** 进入即对待验证版本执行上线／回退检查（概览的「上线 vX…」带来）。 */ readonly switch?: boolean }
/** 发布定位不能退回到“最新一条”，未知 ID 由详情如实显示。路由把 `switch=1` 解析成数字 1，与 `true`／`'1'` 一并接受。 */
export function parseReleaseSearch(raw: Record<string, unknown>): ReleaseSearch {
  return { source: raw.source === 'session' || raw.source === 'repository' ? raw.source : undefined, release: searchText(raw.release, 128), ...(raw.switch === true || raw.switch === 1 || raw.switch === 'true' || raw.switch === '1' ? { switch: true } : {}) };
}
