import { parseSettingsSearch, searchText } from './settingsSearch';
import type { SettingsSearch } from './settingsSearch';
import type { DevelopmentSearch } from './developmentSearch';

/** 「开发资源」的五个主题（RFC-009）。RFC-020 取消了这个入口（作者裁定 D2）：主题各归其家，这里只剩解析旧地址、算出新家。 */
export const RESOURCE_SECTIONS = ['api', 'events', 'data', 'project', 'guide'] as const;
export const GUIDE_TOPICS = ['identity', 'environment', 'mcp', 'tasks'] as const;
export type ResourceSection = typeof RESOURCE_SECTIONS[number];
export type GuideTopic = typeof GUIDE_TOPICS[number];
export interface ResourceSearch {
  readonly section?: ResourceSection;
  readonly proxy?: string;
  readonly operation?: string;
  readonly subscription?: string;
  readonly topic?: GuideTopic;
}
export function parseResourceSearch(raw: Record<string, unknown>): ResourceSearch {
  const section = RESOURCE_SECTIONS.find((value) => value === raw.section) ?? 'api';
  if (section === 'api') return { section, proxy: searchText(raw.proxy, 80), operation: searchText(raw.operation, 2048) };
  if (section === 'events') return { section, subscription: searchText(raw.subscription) };
  if (section === 'guide') return { section, topic: GUIDE_TOPICS.find((value) => value === raw.topic) };
  return { section };
}
export function legacyResourceSearch(raw: Record<string, unknown>): ResourceSearch {
  const search = parseSettingsSearch({ ...raw, tab: 'resources' });
  return resourceDestination(search) ?? { section: 'project' };
}
export function resourceDestination(search: SettingsSearch): ResourceSearch | undefined {
  if (search.tab !== 'resources') return undefined;
  return parseResourceSearch({ ...search, section: search.resource === 'overview' ? 'project' : search.resource });
}

export type ResourceTarget =
  | { readonly page: 'settings'; readonly search: { readonly tab: 'info' } }
  | { readonly page: 'development'; readonly search: DevelopmentSearch };

/** 主题的新家：数据 → 开发页数据面板；项目与仓库 → 项目设置「项目信息」；其余三个主题 → 开发页参考面板（放大形态），参数原样带过去。 */
export function resourceTarget(search: ResourceSearch): ResourceTarget {
  const section = search.section ?? 'api';
  if (section === 'data') return { page: 'development', search: { view: 'data' } };
  if (section === 'project') return { page: 'settings', search: { tab: 'info' } };
  return { page: 'development', search: { view: 'reference', panel: 'full', topic: section,
    ...(search.proxy ? { proxy: search.proxy } : {}), ...(search.operation ? { operation: search.operation } : {}), ...(search.subscription ? { subscription: search.subscription } : {}), ...(search.topic ? { guide: search.topic } : {}) } };
}
