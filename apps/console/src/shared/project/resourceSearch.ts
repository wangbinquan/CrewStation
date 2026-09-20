import { parseSettingsSearch, searchText } from './settingsSearch';
import type { SettingsSearch } from './settingsSearch';

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
  if (search.tab === 'repository') return { section: 'project' };
  if (search.tab !== 'resources') return undefined;
  return parseResourceSearch({ ...search, section: search.resource === 'overview' ? 'project' : search.resource });
}
