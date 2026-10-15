// RFC-034 v2 §5 —— 统计按需聚合：执行按开始时间落在窗口内，窗口过滤 + GROUP BY，没有报告或水位。
// 项目页先按项目 view 授权，只看本项目的执行，人民币由项目费用可见性决定；系统页仅管理员，金额始终可见。

import type {
  Actor, AgentCallKind, AgentCallSource, ObservationAgentPage, ObservationAgentRow, ObservationCall, ObservationModelPage, ObservationOverview,
  ObservationPlatformPage, ObservationPlatformQuery, ObservationProjectPage, ObservationProjectRow, ObservationTaskDetail, ObservationTaskPage,
  ObservationTaskPageQuery, ObservationTaskRef, ObservationUsage, ObservationWindowQuery, ProjectId,
} from '@crewstation/contracts';
import { forbidden, notFound, validation } from '@crewstation/kernel';
import { dayIndexes, dayLabel, decodeCursor, encodeCursor } from '../domain/observationStatistics';
import type { AgentCallStore, CallAggregate, CallModelRow, CallRow, CallScope } from '../ports/agentCalls';
import type { CostVisibilityStore, ObservationProjectNames } from '../ports/observationPricing';
import type { ProjectAuthorizer } from '../ports/sources';

export const TASK_PAGE_SIZE = 25;
export const TASK_CALL_LIMIT = 2_000;
export const AGENT_LIMIT = 200;
export const MODEL_LIMIT = 500;
export const PROJECT_LIMIT = 500;
export const PLATFORM_PAGE_SIZE = 50;
const TOP = 5;

export interface RuntimeStatistics {
  overview(actor: Actor, projectId: ProjectId | null, query: ObservationWindowQuery): Promise<ObservationOverview>;
  tasks(actor: Actor, projectId: ProjectId | null, query: ObservationTaskPageQuery): Promise<ObservationTaskPage>;
  task(actor: Actor, projectId: ProjectId | null, taskId: string): Promise<ObservationTaskDetail>;
  agents(actor: Actor, projectId: ProjectId | null, query: ObservationWindowQuery): Promise<ObservationAgentPage>;
  models(actor: Actor, projectId: ProjectId | null, query: ObservationWindowQuery): Promise<ObservationModelPage>;
  projects(actor: Actor, query: ObservationWindowQuery): Promise<ObservationProjectPage>;
  platform(actor: Actor, query: ObservationPlatformQuery): Promise<ObservationPlatformPage>;
}

const ZERO: ObservationUsage = { calls: 0, incompleteCalls: 0, failedCalls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, costNano: '0', unpricedCalls: 0 };
type UsageRow = Pick<CallAggregate, 'calls' | 'incompleteCalls' | 'failedCalls' | 'input' | 'cacheRead' | 'cacheWrite' | 'output' | 'reasoning' | 'costNano' | 'unpricedCalls'>;

function usageOf(row: UsageRow | undefined, costVisible: boolean): ObservationUsage {
  if (!row) return { ...ZERO, costNano: costVisible ? '0' : null };
  return { calls: row.calls, incompleteCalls: row.incompleteCalls, failedCalls: row.failedCalls, input: row.input, cacheRead: row.cacheRead,
    cacheWrite: row.cacheWrite, output: row.output, reasoning: row.reasoning, costNano: costVisible ? row.costNano : null, unpricedCalls: row.unpricedCalls };
}
const tokensOf = (usage: Pick<ObservationUsage, 'input' | 'cacheRead' | 'cacheWrite' | 'output'>) => usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
const nano = (value: string | null) => BigInt(value ?? '0');
function byConsumption<T extends { readonly usage: ObservationUsage }>(a: T, b: T): number {
  const tokens = tokensOf(b.usage) - tokensOf(a.usage);
  if (tokens !== 0) return tokens;
  const cost = nano(b.usage.costNano) - nano(a.usage.costNano);
  return cost > 0n ? 1 : cost < 0n ? -1 : 0;
}
const iso = (ms: number) => new Date(ms).toISOString();
const isoOrNull = (ms: number | null) => (ms === null ? null : iso(ms));

function callView(row: CallRow, models: readonly CallModelRow[], costVisible: boolean): ObservationCall {
  return {
    id: row.id, source: row.source, kind: row.kind, projectId: row.projectId, taskId: row.taskId, taskLabel: row.taskLabel, subtaskId: row.subtaskId, attempt: row.attempt,
    agentKey: row.agentKey, agentLabel: row.agentLabel, profileId: row.profileId, profileName: row.profileName, profileRevision: row.profileRevision, protocol: row.protocol,
    status: row.status, startedAt: iso(row.startedAt), endedAt: isoOrNull(row.endedAt), usageState: row.usageState, costState: row.costState,
    input: row.input, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite, output: row.output, reasoning: row.reasoning, costNano: costVisible ? row.costNano : null,
    models: models.map((model) => ({ model: model.model, input: model.input, cacheRead: model.cacheRead, cacheWrite: model.cacheWrite, output: model.output,
      reasoning: model.reasoning, costNano: costVisible ? model.costNano : null })),
  };
}
function groupModels(rows: readonly CallModelRow[]): Map<string, CallModelRow[]> {
  const grouped = new Map<string, CallModelRow[]>();
  for (const row of rows) grouped.set(row.callId, [...(grouped.get(row.callId) ?? []), row]);
  return grouped;
}
function callUsage(row: CallRow): UsageRow {
  return { calls: 1, incompleteCalls: row.usageState === 'complete' ? 0 : 1, failedCalls: row.status === 'failed' || row.status === 'interrupted' ? 1 : 0,
    input: row.input, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite, output: row.output, reasoning: row.reasoning, costNano: row.costNano,
    unpricedCalls: row.costState === 'unpriced' || row.costState === 'partial' ? 1 : 0 };
}
function addUsage(a: UsageRow, b: UsageRow): UsageRow {
  return { calls: a.calls + b.calls, incompleteCalls: a.incompleteCalls + b.incompleteCalls, failedCalls: a.failedCalls + b.failedCalls, input: a.input + b.input,
    cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, output: a.output + b.output, reasoning: a.reasoning + b.reasoning,
    costNano: String(BigInt(a.costNano) + BigInt(b.costNano)), unpricedCalls: a.unpricedCalls + b.unpricedCalls };
}
const agentRow = (row: CallAggregate, costVisible: boolean): ObservationAgentRow => ({ agentKey: row.key ?? '', agentLabel: row.label ?? row.key ?? '', tasks: row.tasks, durationMs: row.durationMs, usage: usageOf(row, costVisible) });
const taskRef = (row: CallAggregate, costVisible: boolean): ObservationTaskRef => ({ taskId: row.key ?? '', source: row.source ?? 'business', label: row.label ?? row.key ?? '', projectId: row.projectId, usage: usageOf(row, costVisible) });
const window = (query: { from: string; to: string }) => ({ from: Date.parse(query.from), to: Date.parse(query.to) });
const isTaskCursor = (value: unknown[]): value is [number, string] => value.length === 2 && Number.isSafeInteger(value[0]) && typeof value[1] === 'string';
/** 客户端带回的游标不合法是请求错误（400），不是服务故障。 */
function cursorOf(cursor: string | undefined): [number, string] | null {
  try { return decodeCursor(cursor, isTaskCursor); } catch { throw validation('分页游标无效', { code: 'invalid_cursor' }); }
}

interface StatisticsDeps { readonly calls: AgentCallStore; readonly authorizer: ProjectAuthorizer; readonly visibility: CostVisibilityStore; readonly projects: ObservationProjectNames; readonly clock?: () => number }
interface Context { readonly deps: StatisticsDeps; readonly clock: () => number; access(actor: Actor, projectId: ProjectId | null): Promise<{ scope: CallScope; costVisible: boolean }> }

function contextOf(deps: StatisticsDeps): Context {
  return {
    deps, clock: deps.clock ?? Date.now,
    /** 项目页：view 授权 + 费用可见性；系统页：仅管理员，金额可见。 */
    async access(actor, projectId) {
      if (projectId === null) {
        if (!actor.isAdmin) throw forbidden();
        return { scope: { kind: 'all' }, costVisible: true };
      }
      await deps.authorizer.authorize(actor, projectId, 'view');
      return { scope: { kind: 'project', projectId }, costVisible: (await deps.visibility.read(projectId))?.visible === true };
    },
  };
}

async function projectRows(ctx: Context, rows: readonly CallAggregate[]): Promise<ObservationProjectRow[]> {
  const ids = rows.flatMap((row) => (row.key ? [row.key as ProjectId] : []));
  const names = ids.length ? await ctx.deps.projects.names(ids) : new Map<ProjectId, string>();
  return rows.flatMap((row) => (row.key ? [{ projectId: row.key as ProjectId, projectName: names.get(row.key as ProjectId) ?? null, tasks: row.tasks, usage: usageOf(row, true) }] : []));
}
const systemOrder = (a: CallAggregate, b: CallAggregate) => byConsumption({ usage: usageOf(a, true) }, { usage: usageOf(b, true) });

async function overview(ctx: Context, actor: Actor, projectId: ProjectId | null, query: ObservationWindowQuery): Promise<ObservationOverview> {
  const { scope, costVisible } = await ctx.access(actor, projectId), asOf = ctx.clock(), range = window(query), filter = { ...range, scope }, calls = ctx.deps.calls;
  const [bySource, byStatus, byDay, byTask, byAgent, byProject, durations] = await Promise.all([
    calls.aggregate(filter, 'source'), calls.aggregate(filter, 'status'), calls.aggregate(filter, 'day', query.tzOffset), calls.aggregate(filter, 'task'),
    calls.aggregate(filter, 'agent'), projectId === null ? calls.aggregate(filter, 'project') : Promise.resolve([]), calls.durations(filter),
  ]);
  const sourceUsage = (source: AgentCallSource) => usageOf(bySource.find((row) => row.key === source), costVisible);
  const total = bySource.reduce<UsageRow>((sum, row) => addUsage(sum, row), { ...ZERO, costNano: '0' });
  const status = (key: string) => byStatus.find((row) => row.key === key)?.calls ?? 0;
  const days = new Map(byDay.map((row) => [row.key, row]));
  return {
    asOf: iso(asOf), from: query.from, to: query.to, costVisible, usage: usageOf(total, costVisible),
    bySource: { business: sourceUsage('business'), development: sourceUsage('development'), platform: sourceUsage('platform') },
    statuses: { running: status('running'), done: status('done'), failed: status('failed'), canceled: status('canceled'), interrupted: status('interrupted') },
    durations,
    daily: dayIndexes(range.from, range.to, query.tzOffset).map((index) => {
      const row = days.get(String(index));
      return { day: dayLabel(index), calls: row?.calls ?? 0, input: row?.input ?? 0, cacheRead: row?.cacheRead ?? 0, cacheWrite: row?.cacheWrite ?? 0, output: row?.output ?? 0,
        costNano: costVisible ? row?.costNano ?? '0' : null };
    }),
    topTasks: byTask.map((row) => taskRef(row, costVisible)).sort(byConsumption).slice(0, TOP),
    topAgents: byAgent.map((row) => agentRow(row, costVisible)).sort(byConsumption).slice(0, TOP),
    topProjects: await projectRows(ctx, [...byProject].sort(systemOrder).slice(0, TOP)),
  };
}

async function tasks(ctx: Context, actor: Actor, projectId: ProjectId | null, query: ObservationTaskPageQuery): Promise<ObservationTaskPage> {
  const { scope, costVisible } = await ctx.access(actor, projectId);
  const after = cursorOf(query.cursor);
  const rows = await ctx.deps.calls.taskPage({ filter: { ...window(query), scope, ...(query.source ? { source: query.source } : {}) }, ...(query.q ? { q: query.q } : {}),
    after: after ? { firstStartedAt: after[0], taskId: after[1] } : null, limit: TASK_PAGE_SIZE + 1 });
  const page = rows.slice(0, TASK_PAGE_SIZE), last = page.at(-1);
  return {
    asOf: iso(ctx.clock()), costVisible,
    items: page.map((row) => ({ taskId: row.key ?? '', source: row.source ?? 'business', label: row.label ?? row.key ?? '', projectId: row.projectId,
      firstStartedAt: iso(row.firstStartedAt ?? 0), lastEndedAt: isoOrNull(row.lastEndedAt), running: row.running > 0, agents: row.agents, usage: usageOf(row, costVisible) })),
    nextCursor: rows.length > TASK_PAGE_SIZE && last ? encodeCursor([last.firstStartedAt ?? 0, last.key ?? '']) : null,
  };
}

async function task(ctx: Context, actor: Actor, projectId: ProjectId | null, taskId: string): Promise<ObservationTaskDetail> {
  const { scope, costVisible } = await ctx.access(actor, projectId);
  const found = await ctx.deps.calls.taskCalls(taskId, scope, TASK_CALL_LIMIT);
  const first = found.calls[0];
  if (!first) throw notFound('运行任务', taskId);
  const models = groupModels(found.models);
  return {
    asOf: iso(ctx.clock()), costVisible,
    task: { taskId, source: first.source, label: found.calls.at(-1)?.taskLabel ?? first.taskLabel, projectId: first.projectId },
    usage: usageOf(found.calls.map(callUsage).reduce(addUsage, { ...ZERO, costNano: '0' }), costVisible),
    calls: found.calls.map((row) => callView(row, models.get(row.id) ?? [], costVisible)),
    truncated: found.truncated,
  };
}

async function platform(ctx: Context, actor: Actor, query: ObservationPlatformQuery): Promise<ObservationPlatformPage> {
  if (!actor.isAdmin) throw forbidden();
  const filter = { ...window(query), scope: { kind: 'platform' } as const }, before = cursorOf(query.cursor);
  const [kinds, recent] = await Promise.all([
    ctx.deps.calls.aggregate(filter, 'kind'),
    ctx.deps.calls.recentCalls(filter, before ? { startedAt: before[0], id: before[1] } : null, PLATFORM_PAGE_SIZE + 1),
  ]);
  const page = recent.calls.slice(0, PLATFORM_PAGE_SIZE), models = groupModels(recent.models), last = page.at(-1);
  return {
    asOf: iso(ctx.clock()),
    kinds: kinds.flatMap((row) => (isKind(row.key) ? [{ kind: row.key, usage: usageOf(row, true) }] : [])).sort(byConsumption),
    recent: page.map((row) => callView(row, models.get(row.id) ?? [], true)),
    nextCursor: recent.calls.length > PLATFORM_PAGE_SIZE && last ? encodeCursor([last.startedAt, last.id]) : null,
  };
}
const isKind = (key: string | null): key is AgentCallKind => key === 'subtask' || key === 'agent' || key === 'cli' || key === 'profile-test';

export function runtimeStatistics(deps: StatisticsDeps): RuntimeStatistics {
  const ctx = contextOf(deps);
  return {
    overview: (actor, projectId, query) => overview(ctx, actor, projectId, query),
    tasks: (actor, projectId, query) => tasks(ctx, actor, projectId, query),
    task: (actor, projectId, taskId) => task(ctx, actor, projectId, taskId),
    async agents(actor, projectId, query) {
      const { scope, costVisible } = await ctx.access(actor, projectId);
      const rows = (await deps.calls.aggregate({ ...window(query), scope }, 'agent')).map((row) => agentRow(row, costVisible)).sort(byConsumption);
      return { asOf: iso(ctx.clock()), costVisible, truncated: rows.length > AGENT_LIMIT, items: rows.slice(0, AGENT_LIMIT) };
    },
    async models(actor, projectId, query) {
      const { scope, costVisible } = await ctx.access(actor, projectId);
      const rows = (await deps.calls.aggregateModels({ ...window(query), scope }))
        .map((row) => ({ profileId: row.profileId, profileName: row.profileName, protocol: row.protocol, model: row.model, usage: usageOf(row, costVisible) })).sort(byConsumption);
      return { asOf: iso(ctx.clock()), costVisible, truncated: rows.length > MODEL_LIMIT, items: rows.slice(0, MODEL_LIMIT) };
    },
    async projects(actor, query) {
      if (!actor.isAdmin) throw forbidden();
      const rows = (await deps.calls.aggregate({ ...window(query), scope: { kind: 'all' } }, 'project')).sort(systemOrder);
      return { asOf: iso(ctx.clock()), costVisible: true, truncated: rows.length > PROJECT_LIMIT, items: await projectRows(ctx, rows.slice(0, PROJECT_LIMIT)) };
    },
    platform: (actor, query) => platform(ctx, actor, query),
  };
}
