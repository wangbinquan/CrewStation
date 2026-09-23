import type {
  EventId, SubtaskId, TaskId, TraceChainDto, TraceExecutionDto, TraceId, TraceSource, TraceStatus, TraceSubtaskDto, TraceSummaryDto, TraceTaskDto, UserId,
} from '@crewstation/contracts';
import type { TracePosition } from './tracePaging';
import type { TraceBusinessTaskPart, TraceDeliveryPart, TraceEnvironmentPart, TraceEventSummary, TraceSubtaskPart } from './traceParts';

/** 一条链在本项目里的全部部件；各数组按创建时间正序。 */
export interface TraceParts {
  readonly environments: readonly TraceEnvironmentPart[];
  readonly deliveries: readonly TraceDeliveryPart[];
  readonly businessTasks: readonly TraceBusinessTaskPart[];
}

const ACTIVE_ENVIRONMENT = new Set(['creating', 'running', 'paused', 'releasing']);
/** 还没有结果的投递：待投、投递中、等重试、维护暂存。 */
const ACTIVE_DELIVERY = new Set(['pending', 'delivering', 'retrying', 'held']);
const ACTIVE_BUSINESS = new Set(['creating', 'running', 'paused', 'closing']);
const ACTIVE_EXECUTION = new Set(['queued', 'starting', 'running']);
const SOURCE_ORDER: readonly TraceSource[] = ['event', 'business-task', 'dev-session'];

/** 子任务的最后一次尝试：没有被后来的重试接替的那些。 */
export function latestAttempts(subtasks: readonly TraceSubtaskPart[]): TraceSubtaskPart[] {
  const superseded = new Set(subtasks.flatMap((s) => (s.retryOf ? [s.retryOf] : [])));
  return subtasks.filter((s) => !superseded.has(s.id));
}

/** 一个任务（开发会话或业务任务）的三档状态：重试成功的子任务不算失败，取消的也不算。 */
export function taskStatus(root: TraceEnvironmentPart, business: TraceBusinessTaskPart | undefined): TraceStatus {
  if (ACTIVE_ENVIRONMENT.has(root.state) || (business !== undefined && ACTIVE_BUSINESS.has(business.state))) return 'running';
  const failed = root.state === 'failed' || business?.state === 'failed' || latestAttempts(business?.subtasks ?? []).some((s) => s.state === 'failed');
  return failed ? 'failed' : 'ended';
}

/**
 * 整条链的三档状态（2026-09-23 作者裁定）：任何一部分还在进行就是进行中；否则死信、业务任务失败、
 * 子任务最终失败、会话或任务容器失败算失败；其余（业务任务关闭、会话正常释放、事件已送达）是已结束。
 * 单个 CLI 或 Agent 执行失败只记在它自己那一行，不让整条链变成失败。
 */
export function traceStatus(parts: TraceParts): TraceStatus {
  const running = parts.environments.some((e) => ACTIVE_ENVIRONMENT.has(e.state)) || parts.deliveries.some((d) => ACTIVE_DELIVERY.has(d.state))
    || parts.businessTasks.some((b) => ACTIVE_BUSINESS.has(b.state));
  if (running) return 'running';
  const business = new Map(parts.businessTasks.map((b) => [b.id, b]));
  const failed = parts.deliveries.some((d) => d.state === 'dead')
    || parts.environments.some((e) => !e.native && taskStatus(e, business.get(e.id)) === 'failed')
    || parts.businessTasks.some((b) => b.state === 'failed' || latestAttempts(b.subtasks).some((s) => s.state === 'failed'));
  return failed ? 'failed' : 'ended';
}

/**
 * 列表里的位置：链上最早的任务环境或投递的创建时间。业务任务记录不参与——它与同 ID 的任务环境同时建立，
 * 而列表翻页只按任务环境与投递两个来源扫描，位置必须能由它们算出来（见 `scannedFloor`）。
 */
export function tracePosition(traceId: string, parts: TraceParts): TracePosition | undefined {
  const starts = [...parts.environments.map((e) => e.createdAt), ...parts.deliveries.map((d) => d.createdAt)].sort();
  return starts[0] === undefined ? undefined : { at: starts[0], traceId };
}

function lastActivity(parts: TraceParts): string {
  const times = [
    ...parts.environments.flatMap((e) => [e.updatedAt, e.lastActivityAt]), ...parts.deliveries.map((d) => d.updatedAt),
    ...parts.businessTasks.flatMap((b) => [b.updatedAt, ...(b.closedAt ? [b.closedAt] : []), ...b.subtasks.flatMap((s) => (s.endedAt ? [s.endedAt] : []))]),
  ];
  return times.sort().at(-1) ?? '';
}

function sourcesOf(parts: TraceParts): TraceSource[] {
  const roots = parts.environments.filter((e) => !e.native);
  const present: Record<TraceSource, boolean> = {
    event: parts.deliveries.length > 0,
    'business-task': parts.businessTasks.length > 0 || roots.some((r) => r.kind === 'business'),
    'dev-session': roots.some((r) => r.kind === 'dev-session'),
  };
  return SOURCE_ORDER.filter((source) => present[source]);
}

/** 按 traceId 把各来源交来的部件分组；各组内保持来源给的正序。 */
export function groupTraceParts(parts: TraceParts): Map<string, TraceParts> {
  const groups = new Map<string, { environments: TraceEnvironmentPart[]; deliveries: TraceDeliveryPart[]; businessTasks: TraceBusinessTaskPart[] }>();
  const group = (traceId: string) => {
    let found = groups.get(traceId);
    if (!found) { found = { environments: [], deliveries: [], businessTasks: [] }; groups.set(traceId, found); }
    return found;
  };
  for (const e of parts.environments) group(e.traceId).environments.push(e);
  for (const d of parts.deliveries) group(d.traceId).deliveries.push(d);
  for (const b of parts.businessTasks) group(b.traceId).businessTasks.push(b);
  return groups;
}

/** 列表的一行；链在本项目里既没有任务环境也没有投递时返回 undefined。 */
export function summarizeTrace(traceId: string, parts: TraceParts): TraceSummaryDto | undefined {
  const position = tracePosition(traceId, parts), sources = sourcesOf(parts);
  if (!position || sources.length === 0) return undefined;
  const roots = parts.environments.filter((e) => !e.native), executions = parts.environments.filter((e) => e.native);
  const session = roots.find((r) => r.kind === 'dev-session'), delivery = parts.deliveries[0];
  const subtasks = parts.businessTasks.flatMap((b) => latestAttempts(b.subtasks));
  return {
    traceId: traceId as TraceId, status: traceStatus(parts), startedAt: position.at, lastActivityAt: lastActivity(parts), sources,
    ...(delivery ? { event: { eventType: delivery.eventType, state: delivery.state, attempts: delivery.attempts } } : {}),
    ...(session ? { devSession: {
      ...(session.createdBy ? { createdBy: session.createdBy as UserId } : {}), ...(session.branch ? { branch: session.branch } : {}),
      clis: executions.filter((x) => x.native?.purpose === 'cli').length, agents: executions.filter((x) => x.native?.purpose === 'agent').length,
    } } : {}),
    ...(sources.includes('business-task') ? { business: {
      tasks: Math.max(parts.businessTasks.length, roots.filter((r) => r.kind === 'business').length), subtasks: subtasks.length, failedSubtasks: subtasks.filter((s) => s.state === 'failed').length,
    } } : {}),
  };
}

/** 一条链的分层回放：任务 → 其下的 Agent 执行与业务子任务；summaries 以执行环境的 taskId 为键。 */
export function assembleChain(traceId: string, parts: TraceParts, summaries: ReadonlyMap<string, TraceEventSummary>): TraceChainDto | undefined {
  const summary = summarizeTrace(traceId, parts);
  if (!summary) return undefined;
  const business = new Map(parts.businessTasks.map((b) => [b.id, b]));
  const tasks = parts.environments.filter((e) => !e.native && e.kind !== 'profile-test')
    .map((root) => traceTask(root, business.get(root.id), parts.environments.filter((e) => e.native?.parentTaskId === root.id), summaries));
  const delivery = parts.deliveries[0];
  return {
    traceId: summary.traceId, status: summary.status, startedAt: summary.startedAt, lastActivityAt: summary.lastActivityAt, sources: summary.sources,
    ...(delivery ? { event: {
      deliveryId: delivery.id, eventId: delivery.eventId as EventId, eventType: delivery.eventType, state: delivery.state, attempts: delivery.attempts, createdAt: delivery.createdAt,
      ...(delivery.deliveredAt ? { deliveredAt: delivery.deliveredAt } : {}), ...(delivery.nextAttemptAt ? { nextAttemptAt: delivery.nextAttemptAt } : {}), ...(delivery.lastError ? { lastError: delivery.lastError } : {}),
    } } : {}),
    tasks,
  };
}

function traceTask(root: TraceEnvironmentPart, business: TraceBusinessTaskPart | undefined, executions: readonly TraceEnvironmentPart[], summaries: ReadonlyMap<string, TraceEventSummary>): TraceTaskDto {
  const subtasks = business?.subtasks ?? [];
  const byExecution = new Map(subtasks.flatMap((s) => (s.executionTaskId ? [[s.executionTaskId, s] as const] : [])));
  const status = taskStatus(root, business);
  const times = [root.lastActivityAt, root.updatedAt, ...(business ? [business.updatedAt] : [])].sort();
  return {
    taskId: root.id, kind: root.kind === 'business' ? 'business' : 'dev-session', state: root.state, status, createdAt: root.createdAt, lastActivityAt: times.at(-1) ?? root.lastActivityAt,
    ...(status !== 'running' ? { endedAt: business?.closedAt ?? root.updatedAt } : {}),
    ...(root.createdBy ? { createdBy: root.createdBy as UserId } : {}), ...(root.branch ? { branch: root.branch } : {}), ...(root.message ? { message: root.message } : {}),
    ...(business ? { business: { state: business.state, callerIdentity: business.callerIdentity, ...(business.closedAt ? { closedAt: business.closedAt } : {}) } } : {}),
    executions: executions.map((x) => traceExecution(x, summaries.get(x.id), byExecution.get(x.id))),
    subtasks: subtasks.map(traceSubtask),
  };
}

function traceExecution(x: TraceEnvironmentPart, summary: TraceEventSummary | undefined, subtask: TraceSubtaskPart | undefined): TraceExecutionDto {
  const native = x.native!;
  const running = ACTIVE_EXECUTION.has(native.state);
  const status: TraceStatus = running ? 'running' : x.state === 'failed' || subtask?.state === 'failed' ? 'failed' : 'ended';
  const sessionIds = [...new Set([...(summary?.sessionIds ?? []), ...(subtask?.sessionId ? [subtask.sessionId] : [])])];
  return {
    taskId: x.id, purpose: native.purpose, agentId: native.agentId, profileName: native.profile.name, ...(summary?.protocol ? { protocol: summary.protocol } : {}),
    status, startedAt: x.createdAt, ...(running ? {} : { endedAt: x.updatedAt }), ...(native.failureReason ? { failureReason: native.failureReason } : {}),
    ...(subtask ? { subtaskId: subtask.id } : {}), sessionIds, events: summary?.events ?? 0,
  };
}

function traceSubtask(s: TraceSubtaskPart): TraceSubtaskDto {
  return {
    subtaskId: s.id as SubtaskId, name: s.name, kind: s.kind, ...(s.mode ? { mode: s.mode } : {}), state: s.state, attempt: s.attempt, ...(s.retryOf ? { retryOf: s.retryOf } : {}),
    ...(s.agentProfileName ? { agentProfileName: s.agentProfileName } : {}), ...(s.sessionId ? { sessionId: s.sessionId } : {}), ...(s.error ? { error: s.error } : {}),
    createdAt: s.createdAt, ...(s.endedAt ? { endedAt: s.endedAt } : {}), ...(s.executionTaskId ? { executionTaskId: s.executionTaskId as TaskId } : {}),
  };
}
