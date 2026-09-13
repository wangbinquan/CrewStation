import { searchText } from './settingsSearch';

export type PublishSource = 'session' | 'repository';
export interface ReleaseSearch { readonly source?: PublishSource; readonly release?: string }
/** 发布定位不能退回到“最新一条”，未知 ID 由详情如实显示。 */
export function parseReleaseSearch(raw: Record<string, unknown>): ReleaseSearch {
  return { source: raw.source === 'session' || raw.source === 'repository' ? raw.source : undefined, release: searchText(raw.release, 128) };
}
