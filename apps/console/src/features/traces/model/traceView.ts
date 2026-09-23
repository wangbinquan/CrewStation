import type { TraceSource, TraceStatus, TraceSummaryDto, TraceWindow } from '@crewstation/contracts';
import type { BadgeTone } from '../../../shared/ui/Badge';

/** 列表的筛选：都放在地址里（`traceSource`／`traceStatus`／`traceWindow`），缺省是「全部」。 */
export interface TraceFilters {
  readonly source?: TraceSource;
  readonly status?: TraceStatus;
  readonly window: TraceWindow;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

export const TRACE_SOURCES: readonly TraceSource[] = ['event', 'business-task', 'dev-session'];
export const TRACE_STATUSES: readonly TraceStatus[] = ['running', 'ended', 'failed'];
export const TRACE_WINDOWS: readonly TraceWindow[] = ['1h', '24h', '7d', 'all'];

/** 失败靠颜色与文字一起区分；进行中是提示色，已结束是中性色。 */
export function statusTone(status: TraceStatus): BadgeTone {
  return status === 'failed' ? 'danger' : status === 'running' ? 'info' : 'neutral';
}

/** 长 ID 只露出开头，完整值放在悬停提示与复制里。 */
export const shortId = (id: string): string => (id.length > 12 ? `${id.slice(0, 8)}…` : id);

/** 成员名单里查不到的人（例如不在项目里的管理员）显示成「用户 + 短 ID」，不冒充名字。 */
export function userLabel(names: ReadonlyMap<string, string>, userId: string | undefined, t: Translate): string | undefined {
  if (!userId) return undefined;
  return names.get(userId) ?? t('traces.user.unknown', { id: shortId(userId) });
}

/** 列表一行的首行：起点是什么——事件（带类型）、业务任务或开发会话（带创建人）；事件触发了业务任务时写成「事件 → 业务任务」。 */
export function rowTitle(row: TraceSummaryDto, names: ReadonlyMap<string, string>, t: Translate): string {
  const parts: string[] = [];
  if (row.event) parts.push(t('traces.row.event', { type: row.event.eventType }));
  if (row.sources.includes('business-task')) parts.push(t('traces.source.business-task'));
  if (row.devSession) {
    const user = userLabel(names, row.devSession.createdBy, t);
    parts.push(user ? t('traces.row.devSession', { user }) : t('traces.row.devSessionAnonymous'));
  }
  return parts.join(' → ');
}

/** 列表一行的次行：投递结果、子任务与失败数、会话的分支与 Agent 数。 */
export function rowFacts(row: TraceSummaryDto, t: Translate): string[] {
  const facts: string[] = [];
  if (row.event) facts.push(`${t(`traces.delivery.${row.event.state}`)} · ${t('traces.delivery.attempts', { count: row.event.attempts })}`);
  if (row.business && row.business.subtasks > 0) {
    facts.push(row.business.failedSubtasks > 0 ? t('traces.row.subtasksFailed', { count: row.business.subtasks, failed: row.business.failedSubtasks }) : t('traces.row.subtasks', { count: row.business.subtasks }));
  }
  if (row.devSession) {
    if (row.devSession.branch) facts.push(t('traces.row.branch', { branch: row.devSession.branch }));
    facts.push(t('traces.row.executions', { clis: row.devSession.clis, agents: row.devSession.agents }));
  }
  return facts;
}

/** 起止时间：还在进行的写「… 起」。 */
export function spanText(start: string, end: string | undefined, dateText: (value: string | undefined) => string, t: Translate): string {
  return end ? t('traces.task.span', { start: dateText(start), end: dateText(end) }) : t('traces.task.since', { start: dateText(start) });
}

/** 地址里的筛选值：不认识的一律当「全部」。 */
export function filtersFromSearch(search: { readonly traceSource?: string; readonly traceStatus?: string; readonly traceWindow?: string }): TraceFilters {
  const source = TRACE_SOURCES.find((value) => value === search.traceSource), status = TRACE_STATUSES.find((value) => value === search.traceStatus);
  const window = TRACE_WINDOWS.find((value) => value === search.traceWindow) ?? 'all';
  return { ...(source ? { source } : {}), ...(status ? { status } : {}), window };
}
