import { RuntimeExportQuerySchema, RuntimeExportSchema, ProjectRuntimeStatisticsSchema, SystemRuntimeStatisticsSchema, RuntimeTaskObservationSchema, RuntimeStatisticsQuerySchema } from '@crewstation/contracts';
import type { RuntimeExportQuery, RuntimeExport, RuntimeUsageMetrics, RuntimeStatisticsQuery, RuntimeFactQuery, RuntimeTaskFact, RuntimeTaskObservation, RuntimeAttemptFact, RuntimeAttemptSummary, RuntimeStatistics, RuntimeAgentStatistics, ExecutionObservation } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import { aggregateRuntimeMetrics as aggregate, runtimeUsageMetrics } from '../domain/cnyPricing';
import { selectRuntimeUsage } from '../domain/tokenUsage';
import { intervalDurations } from '../domain/executionIntervals';
import type { RuntimeStatisticsSource, RuntimeStatisticsSnapshot } from '../ports/usageLedger';
import type { Actor, ProjectId, ExecutionObservationPage, ExecutionObservationQuery, SetExecutionCostVisibility, TaskId } from '@crewstation/contracts';
import { ExecutionObservationPageSchema, ExecutionObservationQuerySchema } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, validation, type Clock } from '@crewstation/kernel';
import type { ExecutionCostVisibilityStore, ExecutionObservationAccess, ExecutionObservationCaller, UsageLedgerStore, UsageTaskScope } from '../ports/usageLedger';
import type { ProjectAuthorizer } from '../ports/sources';

interface ObservationReadDeps {
  ledger: UsageLedgerStore; visibility: ExecutionCostVisibilityStore; access: ExecutionObservationAccess;
  authorizer: ProjectAuthorizer; clock: Clock;
}
const cursorPrefix = (scope: UsageTaskScope) => 'usage-v1:' + jsonHash(scope) + ':';
function readCursor(value: string | undefined, scope: UsageTaskScope): number {
  if (value === undefined) return 0;
  const prefix = cursorPrefix(scope), suffix = value.slice(prefix.length);
  if (!value.startsWith(prefix) || !/^(0|[1-9]\d*)$/.test(suffix) || !Number.isSafeInteger(Number(suffix))) throw validation('观测游标无效或不属于当前任务');
  return Number(suffix);
}
async function read(deps: ObservationReadDeps, caller: ExecutionObservationCaller, taskId: TaskId, raw: ExecutionObservationQuery): Promise<ExecutionObservationPage> {
  const query = ExecutionObservationQuerySchema.parse(raw), scope = await deps.access.task(caller, taskId);
  const visibility = await deps.visibility.read(scope.projectId), now = deps.clock.now();
  const prefix = cursorPrefix(scope);
  const base = { schemaVersion: 1 as const, capability: 'executionObservationsV1' as const, ...scope,
    firstAvailableCursor: prefix + '0', visibilityRevision: visibility.revision, costVisibility: visibility.visibility, gaps: [] };
  let page: ExecutionObservationPage;
  if ('snapshot' in query) {
    const snapshot = await deps.ledger.snapshot(scope, query, now.getTime(), visibility.revision);
    page = { ...base, mode: 'snapshot', items: snapshot.items, nextCursor: snapshot.nextCursor,
      snapshotId: snapshot.snapshotId, snapshotThrough: prefix + snapshot.snapshotThrough, persistedThrough: prefix + snapshot.snapshotThrough,
      asOf: new Date(snapshot.createdAt).toISOString(), expiresAt: new Date(snapshot.expiresAt).toISOString() };
  } else {
    const changes = await deps.ledger.changes(scope, readCursor(query.after, scope), query.limit);
    page = { ...base, mode: 'incremental', items: changes.items, nextCursor: changes.hasMore ? prefix + changes.nextCursor : null,
      persistedThrough: prefix + changes.persistedThrough, asOf: now.toISOString() };
  }
  if ((await deps.visibility.read(scope.projectId)).revision !== visibility.revision) throw conflict('金额可见性已变更，请重新读取观测');
  if (visibility.visibility === 'hidden') page.items = page.items.map((item) => item.kind === 'valuation'
    ? { ...item, availability: 'not-authorized', priceVersionRef: null, amountDecimal: null, completeness: 'unknown' } : item);
  return ExecutionObservationPageSchema.parse(page);
}

export function executionObservationUseCases(deps: ObservationReadDeps) {
  const adminProject = async (actor: Actor, projectId: ProjectId) => {
    if (!actor.isAdmin) throw forbidden('只有系统管理员可以设置项目金额可见性');
    await deps.authorizer.authorize(actor, projectId, 'view');
  };
  return {
    executionObservations: (caller: ExecutionObservationCaller, taskId: TaskId, query: ExecutionObservationQuery) => read(deps, caller, taskId, query),
    executionCostVisibility: async (actor: Actor, projectId: ProjectId) => {
      await adminProject(actor, projectId); return deps.visibility.read(projectId);
    },
    setExecutionCostVisibility: async (actor: Actor, projectId: ProjectId, input: SetExecutionCostVisibility) => {
      await adminProject(actor, projectId); return deps.visibility.save(projectId, input, deps.clock.now());
    },
  };
}


interface StatisticsDeps { source: RuntimeStatisticsSource; authorizer: ProjectAuthorizer; clock: Clock }
const running = new Set(['running', 'awaiting-input', 'verifying', 'cancelling']);
const terminal = new Set(['closed', 'succeeded', 'failed', 'cancelled']);
const limits = { tasks: 200, attempts: 2000, records: 20000 };
function attemptRecords(task: RuntimeTaskFact, attempt: RuntimeAttemptFact, rows: ExecutionObservation[]) {
  return rows.filter(({ identity: i }) => i.projectId === task.projectId && i.taskId === task.id && i.subtaskId === attempt.id && i.executionId === attempt.executionId && i.executionGeneration === attempt.attempt);
}
function attemptSummary(task: RuntimeTaskFact, attempt: RuntimeAttemptFact, rows: ExecutionObservation[], visible: boolean, asOf: number, partial: boolean): RuntimeAttemptSummary {
  const start = attempt.startedAt === null ? null : Date.parse(attempt.startedAt);
  const open = attempt.endedAt === null && running.has(attempt.state) && !terminal.has(task.state) && task.closedAt === null;
  const end = attempt.endedAt === null ? open ? asOf : null : Date.parse(attempt.endedAt);
  const durationMs = start !== null && end !== null && start <= end && end <= asOf ? end - start : null;
  return { ...attempt, durationMs, open: open && durationMs !== null, metrics: runtimeUsageMetrics(attemptRecords(task, attempt, rows), visible, attempt.kind === 'agent' ? 1 : 0, partial) };
}
function taskSummary(task: RuntimeTaskFact, snapshot: RuntimeStatisticsSnapshot, scope: 'project' | 'system', asOf: string): RuntimeTaskObservation {
  const now = Date.parse(asOf), visible = scope === 'system' || snapshot.costVisible[task.projectId] === true;
  const rows = snapshot.observations.filter((row) => row.identity.taskId === task.id && row.identity.projectId === task.projectId);
  const unmatched = rows.some((r) => !task.attempts.some((a) => a.executionId === r.identity.executionId && a.id === r.identity.subtaskId && a.attempt === r.identity.executionGeneration));
  const partial = snapshot.partial || task.attemptsPartial || unmatched;
  const attempts = task.attempts.map((a) => attemptSummary(task, a, rows, visible, now, partial));
  const intervals = attempts.flatMap((a) => a.durationMs === null || a.startedAt === null ? [] : [{ start: Date.parse(a.startedAt), end: Date.parse(a.startedAt) + a.durationMs }]);
  const durations = intervalDurations(intervals, { from: 0, to: now, asOf: now });
  const unknownIntervals = attempts.filter((a) => a.durationMs === null).length;
  const start = Date.parse(task.createdAt), end = task.closedAt === null ? terminal.has(task.state) ? null : now : Date.parse(task.closedAt);
  const wallMs = end !== null && end >= start && end <= now ? end - start : null;
  const metrics = aggregate(attempts.map((a) => a.metrics), partial, visible);
  if (unmatched) metrics.reasons.push('identity-unmatched');
  if (unknownIntervals) metrics.reasons.push('timing-missing');
  return RuntimeTaskObservationSchema.parse({ ...task, scope, asOf, attempts, attemptCount: attempts.length, metrics, wallMs, ...durations, unknownIntervals, partial });
}
function grouped<T>(items: T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) { const k = key(item), group = groups.get(k) ?? []; group.push(item); groups.set(k, group); }
  return [...groups.values()];
}
function agentStatistics(tasks: RuntimeTaskObservation[]): RuntimeAgentStatistics[] {
  const pairs = tasks.flatMap((task) => task.attempts.filter((a) => a.kind === 'agent').map((attempt) => ({ task, attempt })));
  const key = ({ task, attempt: a }: typeof pairs[number]) => JSON.stringify([task.projectId, a.agentId ?? a.executionId ?? a.id, a.profileId, a.profileRevision, a.kind]);
  return grouped(pairs, key).map((group) => {
    const first = group[0]!, a = first.attempt;
    return { key: key(first), projectId: first.task.projectId, agentId: a.agentId, profileId: a.profileId, profileRevision: a.profileRevision, kind: a.kind, name: a.name,
      metrics: aggregate(group.map((x) => x.attempt.metrics)), tasks: grouped(group, (x) => x.task.id).map((rows) => ({ taskId: rows[0]!.task.id, metrics: aggregate(rows.map((x) => x.attempt.metrics)), attempts: rows.length })) };
  });
}
function trends(tasks: RuntimeTaskObservation[], query: RuntimeStatisticsQuery) {
  const from = Date.parse(query.from), to = Date.parse(query.to), count = Math.min(24, Math.max(1, Math.ceil((to - from) / 3600000))), step = (to - from) / count;
  return Array.from({ length: count }, (_, i) => {
    const left = Math.floor(from + step * i), right = i === count - 1 ? to : Math.floor(from + step * (i + 1));
    const rows = tasks.filter((task) => Date.parse(task.createdAt) >= left && Date.parse(task.createdAt) < right);
    return { from: new Date(left).toISOString(), to: new Date(right).toISOString(), tasks: rows.length, metrics: aggregate(rows.map((r) => r.metrics)) };
  });
}
function durationStatistics(tasks: RuntimeTaskObservation[]) {
  const samples = tasks.filter((task) => terminal.has(task.state) && task.closedAt !== null && task.wallMs !== null).map((task) => task.wallMs!).sort((a, b) => a - b);
  const percentile = (p: number) => samples.length ? samples[Math.ceil(samples.length * p) - 1]! : null;
  return { samples: samples.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: samples.at(-1) ?? null };
}
function systemDistributions(tasks: RuntimeTaskObservation[], snapshot: RuntimeStatisticsSnapshot) {
  const attempts = tasks.flatMap((task) => task.attempts.filter((a) => a.kind === 'agent').map((attempt) => ({ task, attempt })));
  const profiles = grouped(attempts, ({ attempt: a }) => JSON.stringify([a.profileId, a.profileRevision])).map((rows) => ({ profileId: rows[0]!.attempt.profileId, profileRevision: rows[0]!.attempt.profileRevision, metrics: aggregate(rows.map((r) => r.attempt.metrics)) }));
  const byModel = attempts.flatMap(({ task, attempt }) => {
    const rows = attemptRecords(task, attempt, snapshot.observations), selection = selectRuntimeUsage(rows.filter((r) => r.kind === 'usage'));
    return grouped(selection.selected, (r) => JSON.stringify(r.record.modelRef)).map((selected) => {
      const usage = selected.map(({ record, contribution, whole }) => ({ ...record, projection: { ...record.projection, contribution, complete: whole && record.projection.complete } }));
      const values = rows.filter((r) => r.kind === 'valuation' && selected.some((s) => s.whole && s.record.recordId === r.recordId && s.record.sourceId === r.sourceId));
      return { modelRef: selected[0]!.record.modelRef, metrics: runtimeUsageMetrics([...usage, ...values], true, 1, snapshot.partial || selection.incomplete) };
    });
  });
  const models = grouped(byModel, (r) => JSON.stringify(r.modelRef)).map((rows) => ({ modelRef: rows[0]!.modelRef, metrics: aggregate(rows.map((r) => r.metrics)) }));
  return { profiles, models };
}
function statistics(snapshot: RuntimeStatisticsSnapshot, query: RuntimeStatisticsQuery, asOf: string, projectId?: ProjectId): RuntimeStatistics {
  const scope = projectId === undefined ? 'system' : 'project', tasks = snapshot.tasks.map((t) => taskSummary(t, snapshot, scope, asOf)).filter((task) => (!query.q || `${task.name} ${task.id} ${task.projectId}`.toLowerCase().includes(query.q.toLowerCase())) && (!query.state || task.state === query.state) && (!query.quality || task.metrics.reasons.includes(query.quality)));
  const quality = new Map<string, string[]>();
  for (const task of tasks) for (const reason of task.metrics.reasons) { const ids = quality.get(reason) ?? []; ids.push(task.id); quality.set(reason, ids); }
  const projects = grouped(tasks, (t) => t.projectId).map((rows) => ({ projectId: rows[0]!.projectId, tasks: rows.length, metrics: aggregate(rows.map((r) => r.metrics)) }));
  const common = { asOf, projectionVersion: 1, cohort: 'started', filters: query, partial: snapshot.partial || tasks.some((t) => t.partial), limits,
    metrics: aggregate(tasks.map((t) => t.metrics), snapshot.partial, projectId === undefined || snapshot.costVisible[projectId] === true),
    tasks: tasks.map(({ attempts: _a, scope: _s, asOf: _at, partial: _p, ...task }) => task), agents: agentStatistics(tasks), projects,
    trend: trends(tasks, query), durations: durationStatistics(tasks), quality: [...quality].map(([reason, taskIds]) => ({ reason, taskIds })), sourceScope: 'business-tasks' };
  return projectId === undefined ? SystemRuntimeStatisticsSchema.parse({ ...common, scope, ...systemDistributions(tasks, snapshot) }) : ProjectRuntimeStatisticsSchema.parse({ ...common, scope, projectId });
}

function exportStatistics(data: RuntimeStatistics, query: RuntimeExportQuery): RuntimeExport {
  const tasks = data.tasks.filter((task) => (!query.q || `${task.name} ${task.id} ${task.projectId}`.toLowerCase().includes(query.q.toLowerCase())) &&
    (!query.state || task.state === query.state) && (!query.quality || task.metrics.reasons.includes(query.quality)));
  const ids = new Set(tasks.map((task) => task.id));
  const columns = ['as_of', 'window_from', 'window_to', 'timezone', 'source_scope', 'scope', 'view', 'project_id', 'id', 'name', 'group_key', 'agent_id', 'profile_id', 'profile_revision', 'kind', 'state', 'tasks', 'attempts', 'wall_ms', 'cumulative_ms', 'active_union_ms',
    'input_tokens', 'cache_read_tokens', 'cache_write_tokens', 'output_tokens', 'known_tokens', 'tokens_complete', 'input_unknown', 'cache_read_unknown', 'cache_write_unknown', 'output_unknown', 'currency', 'known_cost', 'cost_visible', 'cost_complete', 'quality', 'result_partial'];
  const metrics = (m: RuntimeUsageMetrics) => [m.tokens.input, m.tokens.cacheRead, m.tokens.cacheWrite, m.tokens.output, m.tokens.hasKnown ? m.tokens.total : '', m.tokens.complete,
    m.tokens.unknownBuckets.input, m.tokens.unknownBuckets.cacheRead, m.tokens.unknownBuckets.cacheWrite, m.tokens.unknownBuckets.output,
    'CNY', m.cost.visible ? m.cost.amount ?? '' : '', m.cost.visible, m.cost.complete, m.reasons.join('|'), data.partial || m.partial];
  const prefix = [data.asOf, data.filters.from, data.filters.to, data.filters.timezone, data.sourceScope, data.scope, query.view];
  const rows = query.view === 'tasks' ? tasks.map((t) => [...prefix, t.projectId, t.id, t.name, '', '', '', '', '', t.state, 1, t.attemptCount, t.wallMs ?? '', t.cumulativeMs, t.activeUnionMs, ...metrics(t.metrics)]) :
    data.agents.filter((a) => !query.agent || a.key === query.agent).flatMap((a) => {
      const contributions = a.tasks.filter((task) => ids.has(task.taskId));
      return contributions.length ? [[...prefix, a.projectId, a.agentId ?? a.key, a.name, a.key, a.agentId ?? '', a.profileId ?? '', a.profileRevision ?? '', a.kind, '', contributions.length, contributions.reduce((n, t) => n + t.attempts, 0), '', '', '', ...metrics(aggregate(contributions.map((t) => t.metrics)))]] : [];
    });
  // Text cells stay text in spreadsheet applications; decimal counters and CNY retain their exact spelling.
  const cell = (value: string | number | boolean) => { const raw = String(value), text = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw; return '"' + text.replaceAll('"', '""') + '"'; };
  return RuntimeExportSchema.parse({ filename: `crewstation-${data.scope}-${query.view}-${data.asOf.slice(0, 10)}.csv`, mediaType: 'text/csv;charset=utf-8',
    content: '\uFEFF' + [columns, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n', asOf: data.asOf, rows: rows.length, partial: data.partial, bounded: true });
}

export function runtimeStatisticsUseCases(deps: StatisticsDeps) {
  const authorize = async (actor: Actor, projectId?: ProjectId) => {
    if (projectId !== undefined) await deps.authorizer.authorize(actor, projectId, 'view');
    else if (!actor.isAdmin) throw forbidden('只有系统管理员可以读取跨项目运行统计');
  };
  const overview = async (actor: Actor, raw: RuntimeStatisticsQuery, projectId?: ProjectId) => {
    const query = RuntimeStatisticsQuerySchema.parse(raw); await authorize(actor, projectId);
    const asOf = deps.clock.now().toISOString(), snapshot = await deps.source.read({ ...query, ...(projectId === undefined ? {} : { projectId }) });
    await authorize(actor, projectId); return statistics(snapshot, query, asOf, projectId);
  };
  const detail = async (actor: Actor, taskId: TaskId, projectId?: ProjectId) => {
    await authorize(actor, projectId); const asOf = deps.clock.now().toISOString();
    const query: RuntimeFactQuery = { from: '1970-01-01T00:00:00.000Z', to: asOf, timezone: 'Asia/Shanghai', taskId, ...(projectId === undefined ? {} : { projectId }) };
    const snapshot = await deps.source.read(query), task = snapshot.tasks.find((t) => t.id === taskId && (projectId === undefined || t.projectId === projectId));
    await authorize(actor, projectId); if (!task) throw notFound('找不到本范围内的任务');
    return taskSummary(task, snapshot, projectId === undefined ? 'system' : 'project', asOf);
  };
  const exportRead = async (actor: Actor, raw: RuntimeExportQuery, projectId?: ProjectId) => { const query = RuntimeExportQuerySchema.parse(raw); return exportStatistics(await overview(actor, query.window, projectId), query); };
  return { projectRuntimeExport: (actor: Actor, projectId: ProjectId, query: RuntimeExportQuery) => exportRead(actor, query, projectId),
    systemRuntimeExport: (actor: Actor, query: RuntimeExportQuery) => exportRead(actor, query),
    projectRuntimeStatistics: async (actor: Actor, projectId: ProjectId, query: RuntimeStatisticsQuery) => ProjectRuntimeStatisticsSchema.parse(await overview(actor, query, projectId)),
    systemRuntimeStatistics: async (actor: Actor, query: RuntimeStatisticsQuery) => SystemRuntimeStatisticsSchema.parse(await overview(actor, query)),
    projectRuntimeTask: (actor: Actor, projectId: ProjectId, taskId: TaskId) => detail(actor, taskId, projectId), systemRuntimeTask: (actor: Actor, taskId: TaskId) => detail(actor, taskId) };
}
