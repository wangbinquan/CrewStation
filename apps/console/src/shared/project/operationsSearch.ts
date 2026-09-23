import { LogQuerySchema, LogSourceSchema, ReleaseIdSchema, TaskIdSchema, TraceIdSchema } from '@crewstation/contracts';
import type { LogSource, SlotName } from '@crewstation/contracts';
import { searchText } from './settingsSearch';

/**
 * 运行与诊断的六个页签：部署与运行形态在最前，也是进来时的默认；健康状态单独一个页签
 * （2026-09-23 作者当面裁定，修订 RFC-020 D3 的「合并为状态」）。
 */
export const OPERATIONS_TABS = ['topology', 'health', 'logs', 'alerts', 'deliveries', 'trace'] as const;
export type OperationsTab = typeof OPERATIONS_TABS[number];
/** RFC-020 D3 合并期间的「状态」仍会出现在书签与旧链接里：落到部署与运行形态，路由再把地址 replace 成新名。 */
const LEGACY_TABS: Readonly<Record<string, OperationsTab>> = { status: 'topology' };
export interface OperationsSearch {
  readonly tab?: OperationsTab;
  readonly source?: LogSource;
  readonly slot?: SlotName | 'all';
  readonly taskId?: string;
  readonly releaseId?: string;
  readonly since?: string;
  readonly limit?: number;
  readonly subscription?: string;
  readonly traceId?: string;
  readonly alertId?: string;
  readonly alertState?: 'all' | 'firing' | 'resolved';
}

export function parseOperationsSearch(raw: Record<string, unknown>): OperationsSearch {
  const tab = OPERATIONS_TABS.find((value) => value === raw.tab) ?? LEGACY_TABS[String(raw.tab)] ?? 'topology';
  if (tab === 'alerts') return { tab, alertId: searchText(raw.alertId, 128), alertState: raw.alertState === 'firing' || raw.alertState === 'resolved' ? raw.alertState : 'all' };
  if (tab === 'trace') return { tab, traceId: TraceIdSchema.safeParse(raw.traceId).data };
  if (tab === 'deliveries') return { tab, subscription: searchText(raw.subscription) };
  if (tab !== 'logs') return { tab };
  const source = LogSourceSchema.safeParse(raw.source).data ?? 'slot';
  return {
    tab, source,
    ...(source === 'slot' ? { slot: raw.slot === 'preview' ? 'preview' : raw.slot === 'all' ? 'all' : 'prod' } : {}),
    ...(['dev-session', 'business-task'].includes(source) ? { taskId: TaskIdSchema.safeParse(raw.taskId).data } : {}),
    ...(['build', 'migration'].includes(source) ? { releaseId: ReleaseIdSchema.safeParse(raw.releaseId).data } : {}),
    since: LogQuerySchema.shape.since.safeParse(raw.since).data,
    limit: LogQuerySchema.shape.limit.safeParse(raw.limit ?? 200).data ?? 200,
  };
}

/** 地址里带的是旧页签名：路由据此做一次 replace，让地址与页面一致。 */
export function hasLegacyOperationsTab(searchStr: string): boolean {
  return /[?&]tab=status(?:&|$)/.test(searchStr);
}
