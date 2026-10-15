import type { AgentCallSource } from '@crewstation/contracts';
import { AGENT_CALL_SOURCES } from '@crewstation/contracts';

// RFC-034 v2 §6：项目与系统两级共用一套页面；系统页多「项目」「平台执行」两个页签。资源与健康保留原实现。
export const RUNTIME_TABS = ['overview', 'tasks', 'agents', 'projects', 'platform', 'resources', 'health'] as const;
export type RuntimeTab = (typeof RUNTIME_TABS)[number];
const PROJECT_TABS: readonly RuntimeTab[] = ['overview', 'tasks', 'agents', 'resources', 'health'];
/** 统计页签：随时间范围读取；资源与健康各自有采样窗口。 */
export const STATISTICS_TABS: readonly RuntimeTab[] = ['overview', 'tasks', 'agents', 'projects', 'platform'];

export const RUNTIME_PERIODS = ['day', 'week', 'month'] as const;
export type RuntimePeriod = (typeof RUNTIME_PERIODS)[number];
export const DEFAULT_PERIOD: RuntimePeriod = 'week';
const PERIOD_DAYS: Readonly<Record<RuntimePeriod, number>> = { day: 1, week: 7, month: 30 };

export interface RuntimeSearch {
  readonly tab?: RuntimeTab;
  readonly period?: RuntimePeriod;
  /** 任务页签的关键词与来源筛选。 */
  readonly q?: string;
  readonly source?: AgentCallSource;
  /** 资源页签的采样历史区间（原实现）。 */
  readonly from?: string;
  readonly to?: string;
}

/** 页面所在的层级：系统，或某个项目（工作台 / 管理空间的接入容器）。 */
export type RuntimeScope =
  | { readonly kind: 'system' }
  | { readonly kind: 'project'; readonly projectId: string; readonly space: 'workbench' | 'admin' };

export const scopeProjectId = (scope: RuntimeScope): string | undefined => (scope.kind === 'project' ? scope.projectId : undefined);
export const runtimeTabs = (scope: RuntimeScope): readonly RuntimeTab[] => (scope.kind === 'system' ? RUNTIME_TABS : PROJECT_TABS);

const date = (value: unknown) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined);
const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' && value.length <= 200 ? value.trim() : undefined);
const member = <T extends string>(values: readonly T[], value: unknown): T | undefined => values.find((candidate) => candidate === value);

export function parseRuntimeSearch(raw: Record<string, unknown>): RuntimeSearch {
  const tab = member(RUNTIME_TABS, raw['tab']), period = member(RUNTIME_PERIODS, raw['period']), source = member(AGENT_CALL_SOURCES, raw['source']);
  const q = text(raw['q']), from = date(raw['from']), to = date(raw['to']);
  return {
    ...(tab ? { tab } : {}), ...(period ? { period } : {}), ...(q ? { q } : {}), ...(source ? { source } : {}),
    ...(from && to && from < to ? { from, to } : {}),
  };
}

export interface ObservationWindow {
  readonly from: string;
  readonly to: string;
  /** 浏览器当前的 UTC 偏移（分钟，东正西负），日桶按它切。 */
  readonly tzOffset: number;
}

/** 截至 `now` 的最近 1 / 7 / 30 天。每次读取（含自动刷新）重新取当时，页面即为当前数据。 */
export function observationWindow(period: RuntimePeriod, now: number): ObservationWindow {
  return { from: new Date(now - PERIOD_DAYS[period] * 86_400_000).toISOString(), to: new Date(now).toISOString(), tzOffset: -new Date(now).getTimezoneOffset() };
}
