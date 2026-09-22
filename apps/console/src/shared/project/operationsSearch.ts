import { LogQuerySchema, LogSourceSchema, ReleaseIdSchema, TaskIdSchema, TraceIdSchema } from '@crewstation/contracts';
import type { LogSource, SlotName } from '@crewstation/contracts';
import { searchText } from './settingsSearch';

/** 运行与诊断的五个页签（RFC-020 D3）：健康状态与部署与运行形态合并为「状态」。 */
export const OPERATIONS_TABS = ['status', 'logs', 'alerts', 'deliveries', 'trace'] as const;
export type OperationsTab = typeof OPERATIONS_TABS[number];
/** RFC-019 之前的两个页签名仍会出现在书签与旧链接里：都落到「状态」，路由再把地址 replace 成新名。 */
const LEGACY_TABS: Readonly<Record<string, OperationsTab>> = { health: 'status', topology: 'status' };
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
  const tab = OPERATIONS_TABS.find((value) => value === raw.tab) ?? LEGACY_TABS[String(raw.tab)] ?? 'status';
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
  return /[?&]tab=(health|topology)(?:&|$)/.test(searchStr);
}
