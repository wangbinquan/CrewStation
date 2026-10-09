import { searchText } from './settingsSearch';

export type PublishSource = 'session' | 'repository';
export interface ReleaseSearch { readonly source?: PublishSource; readonly release?: string; readonly switch?: boolean; readonly cursor?: string; readonly focus?: string; readonly filter?: 'active' | 'ended'; readonly draft?: string; readonly step?: number }
/** 发布定位不能退回到“最新一条”，未知 ID 由详情如实显示。路由把 `switch=1` 解析成数字 1，与 `true`／`'1'` 一并接受。 */
export function parseReleaseSearch(raw: Record<string, unknown>): ReleaseSearch {
  return { source: raw.source === 'session' || raw.source === 'repository' ? raw.source : undefined, release: searchText(raw.release, 128), ...(raw.switch === true || raw.switch === 1 || raw.switch === 'true' || raw.switch === '1' ? { switch: true } : {}),
    cursor: searchText(raw.cursor, 1024), focus: searchText(raw.focus, 128), draft: searchText(raw.draft, 128),
    filter: raw.filter === 'active' || raw.filter === 'ended' ? raw.filter : undefined,
    step: Number.isInteger(Number(raw.step)) && Number(raw.step) >= 0 && Number(raw.step) <= 4 ? Number(raw.step) : undefined };
}
