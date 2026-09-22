import { LogQuerySchema, LogSourceSchema, ReleaseIdSchema, TaskIdSchema, TraceIdSchema } from '@crewstation/contracts';
import type { LogSource, SlotName } from '@crewstation/contracts';
import { searchText } from './settingsSearch';

export const OPERATIONS_TABS = ['health', 'topology', 'alerts', 'logs', 'deliveries', 'trace'] as const;
export interface OperationsSearch {
  readonly tab?: typeof OPERATIONS_TABS[number];
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
  const tab = OPERATIONS_TABS.find((value) => value === raw.tab) ?? 'health';
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
