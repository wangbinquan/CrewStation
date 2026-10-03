export const RUNTIME_TABS = ['overview', 'tasks', 'agents', 'usage', 'performance', 'resources', 'health'] as const;
export type RuntimeTab = typeof RUNTIME_TABS[number];
export interface RuntimeSearch { reportId?: string; tab?: RuntimeTab; from?: string; to?: string; q?: string; state?: string; agent?: string; profile?: string; quality?: string; sourceKind?: 'business-task' | 'development-agent' }
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
export function parseRuntimeSearch(raw: Record<string, unknown>): RuntimeSearch {
  const text = (key: string) => typeof raw[key] === 'string' && raw[key]!.length <= 1000 ? raw[key] as string : undefined;
  const tab = RUNTIME_TABS.find((value) => value === raw['tab']), from = date(raw['from']), to = date(raw['to']);
  return { ...(typeof raw['reportId']==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw['reportId'])?{reportId:raw['reportId']}:{}), ...(tab ? { tab } : {}), ...(from && to && from < to ? { from, to } : {}),
    ...(raw['sourceKind'] === 'business-task' || raw['sourceKind'] === 'development-agent' ? { sourceKind: raw['sourceKind'] } : {}),
    ...(text('q') ? { q: text('q') } : {}), ...(text('state') ? { state: text('state') } : {}), ...(text('profile') ? { profile: text('profile') } : {}), ...(text('agent') ? { agent: text('agent') } : {}), ...(text('quality') ? { quality: text('quality') } : {}) };
}
export function runtimeWindow(search: RuntimeSearch, now = Date.now()) {
  return { from: search.from ?? new Date(now - 86400000).toISOString(), to: search.to ?? new Date(now).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
export function localDateInput(iso: string): string {
  const value = new Date(iso); return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
