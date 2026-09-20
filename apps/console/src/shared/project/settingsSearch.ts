export const SETTINGS_TABS = ['config', 'visibility', 'members', 'advanced'] as const;
export type SettingsTab = typeof SETTINGS_TABS[number];
export interface SettingsSearch {
  readonly tab?: SettingsTab | 'resources' | 'repository' | 'lifecycle';
  readonly env?: 'development' | 'production';
  readonly resource?: 'overview' | 'api' | 'events';
  readonly proxy?: string;
  readonly operation?: string;
  readonly subscription?: string;
}

export function searchText(value: unknown, max = 256): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value) ? value : undefined;
}

/** 旧分组保留到路由重定向完成，避免先清理掉 API / 订阅上下文。 */
export function parseSettingsSearch(raw: Record<string, unknown>): SettingsSearch {
  if (raw.tab === 'repository' || raw.tab === 'lifecycle') return { tab: raw.tab };
  if (raw.tab === 'resources') {
    const resource = raw.resource === 'overview' || raw.resource === 'api' || raw.resource === 'events' ? raw.resource : searchText(raw.operation, 2048) ? 'api' : 'overview';
    if (resource === 'api') return { tab: 'resources', resource, proxy: searchText(raw.proxy, 80), operation: searchText(raw.operation, 2048) };
    return { tab: 'resources', resource, ...(resource === 'events' ? { subscription: searchText(raw.subscription) } : {}) };
  }
  const tab = SETTINGS_TABS.find((value) => value === raw.tab) ?? 'config';
  return tab === 'config' ? { tab, env: raw.env === 'production' ? 'production' : 'development' } : { tab };
}
