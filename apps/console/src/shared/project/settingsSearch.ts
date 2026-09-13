export const SETTINGS_TABS = ['members', 'visibility', 'config', 'resources', 'repository', 'lifecycle'] as const;
export const RESOURCE_TABS = ['overview', 'api', 'events'] as const;
export type SettingsTab = typeof SETTINGS_TABS[number];
export type ResourceTab = typeof RESOURCE_TABS[number];
export interface SettingsSearch {
  readonly tab?: SettingsTab;
  readonly env?: 'development' | 'production';
  readonly resource?: ResourceTab;
  readonly proxy?: string;
  readonly operation?: string;
  readonly subscription?: string;
}

export function searchText(value: unknown, max = 256): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value) ? value : undefined;
}

/** 只保留当前分类适用的参数；无效输入回到该分类默认值。 */
export function parseSettingsSearch(raw: Record<string, unknown>): SettingsSearch {
  const tab = SETTINGS_TABS.find((value) => value === raw.tab) ?? 'members';
  if (tab === 'config') return { tab, env: raw.env === 'production' ? 'production' : 'development' };
  if (tab !== 'resources') return { tab };
  const resource = RESOURCE_TABS.find((value) => value === raw.resource) ?? (searchText(raw.operation, 2048) ? 'api' : 'overview');
  if (resource === 'api') return { tab, resource, proxy: searchText(raw.proxy, 80), operation: searchText(raw.operation, 2048) };
  return { tab, resource, ...(resource === 'events' ? { subscription: searchText(raw.subscription) } : {}) };
}
