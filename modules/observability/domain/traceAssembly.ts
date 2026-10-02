import type { EventId, SubtaskId, TaskId, TraceChainDto, TraceExecutionDto, TraceId, TraceSource, TraceStatus, TraceSubtaskDto, TraceSummaryDto, TraceTaskDto, UserId, BusinessTaskState, DeliveryState, RunnerEvent, SubtaskMode, SubtaskState, TraceTaskState, TraceEventDto } from "@crewstation/contracts";

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

/** 调用链的原始部件（Design §14）：各模块按项目、按 traceId 交来的记录；组装与判定都在本目录的纯函数里。 */

/** 按 traceId 分组的时间键：firstAt 为毫秒精度的开始时间，active 表示这一部分还在进行。 */
export interface TraceKey { readonly traceId: string; readonly firstAt: string; readonly lastAt: string; readonly active: boolean }
/** 链上的任务环境：开发会话、业务任务，以及挂在它们下面的 Agent 执行（native）。 */
export interface TraceEnvironmentPart {
  readonly id: TaskId;
  readonly traceId: string;
  readonly kind: 'dev-session' | 'business' | 'profile-test';
  readonly state: TraceTaskState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastActivityAt: string;
  readonly createdBy?: string;
  readonly branch?: string;
  readonly message?: string;
  readonly native?: {
    readonly purpose: 'cli' | 'agent' | 'subtask';
    readonly parentTaskId: TaskId;
    readonly agentId: string;
    readonly state: 'queued' | 'starting' | 'running' | 'cleaning' | 'finished';
    readonly profile: { readonly name: string };
    readonly failureReason?: string;
  };
}

export interface TraceDeliveryPart {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly traceId: string;
  readonly state: DeliveryState;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deliveredAt?: string;
  readonly nextAttemptAt?: string;
  readonly lastError?: string;
}

export interface TraceSubtaskPart {
  readonly id: SubtaskId;
  readonly taskId: TaskId;
  readonly name: string;
  readonly kind: 'agent' | 'command';
  readonly mode?: SubtaskMode;
  readonly state: SubtaskState;
  readonly attempt: number;
  readonly retryOf?: SubtaskId;
  readonly agentProfileName?: string;
  readonly sessionId?: string;
  readonly error?: string;
  readonly createdAt: string;
  readonly endedAt?: string;
  readonly executionTaskId?: TaskId;
}

export interface TraceBusinessTaskPart {
  readonly id: TaskId;
  readonly traceId: string;
  readonly state: BusinessTaskState;
  readonly callerIdentity: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt?: string;
  readonly subtasks: readonly TraceSubtaskPart[];
}

/** 一个执行环境的事件汇总：指定种类的条数、出现过的原生会话 ID 与 Agent 协议。 */
export interface TraceEventSummary { readonly taskId: TaskId; readonly events: number; readonly sessionIds: readonly string[]; readonly protocol?: string }
export interface TraceStoredEvent { readonly seq: number; readonly at: string; readonly event: RunnerEvent }

/** 一条链在列表里的位置：开始时间（毫秒精度 ISO）＋ traceId；traceId 唯一，所以位置也唯一。 */
export interface TracePosition { readonly at: string; readonly traceId: string }

export const encodeTraceCursor = (position: TracePosition): string => `${position.at}~${position.traceId}`;

/** 游标的格式已由契约校验（`TRACE_CURSOR_PATTERN`）。 */
export function decodeTraceCursor(cursor: string): TracePosition {
  const [at = '', traceId = ''] = cursor.split('~');
  return { at, traceId };
}

/** 列表顺序：开始时间新的在前，同一毫秒按 traceId 倒序。返回负数表示 a 排在 b 前面。 */
export function compareTracePositions(a: TracePosition, b: TracePosition): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.traceId === b.traceId ? 0 : a.traceId < b.traceId ? 1 : -1;
}

/**
 * 多个来源各自按「本来源里的开始时间」倒序给出一页时间键，合并后按整条链最早的开始时间排序。
 * 某个来源给满了 limit 条，它最后一条之后的键这一轮没看到；一条链的最早开始时间又可能落在另一个来源里。
 * 只有不晚于所有给满来源最后一条的位置（取其中最靠前的那个）才保证这一轮已完整看到——返回这个下界；
 * 所有来源都没给满时返回 undefined，表示已经看到底。
 */
export function scannedFloor(batches: readonly (readonly TraceKey[])[], limit: number): TracePosition | undefined {
  let floor: TracePosition | undefined;
  for (const batch of batches) {
    const last = batch.at(-1);
    if (batch.length < limit || !last) continue;
    const position = { at: last.firstAt, traceId: last.traceId };
    if (!floor || compareTracePositions(position, floor) < 0) floor = position;
  }
  return floor;
}

/** 位置落在 (cursor, floor] 之间：比游标更早（游标本身是上一页最后一条），且不早于这一轮的下界。 */
export function withinScannedRange(position: TracePosition, cursor: TracePosition | undefined, floor: TracePosition | undefined): boolean {
  return (!cursor || compareTracePositions(position, cursor) > 0) && (!floor || compareTracePositions(position, floor) <= 0);
}

const WINDOW_MS = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 } as const;

/** 时间范围按「有活动」算的起点；「全部」没有起点。 */
export function windowStart(window: '1h' | '24h' | '7d' | 'all', now: Date): string | undefined {
  return window === 'all' ? undefined : new Date(now.getTime() - WINDOW_MS[window]).toISOString();
}

/**
 * 回放里逐条查看的事件种类：Agent 事件、启动前步骤、CLI 活动信号、终端关闭。平台自己执行的命令（execExited，
 * 工作台读分支、读文件时产生，一个会话可达数万条）、终端输出与文件变化不列。
 */
export const TRACE_EVENT_KINDS: RunnerEvent['kind'][] = ['agent', 'beforeStart', 'nativeActivity', 'terminalClosed'];

/** Agent 文字截到这个长度；完整输出在业务子任务的产物或 CLI 自己的会话里。 */
export const TRACE_TEXT_LIMIT = 2000;

const clip = (text: string) => (text.length > TRACE_TEXT_LIMIT ? `${text.slice(0, TRACE_TEXT_LIMIT)}…` : text);

/**
 * 把一条运行事件映射成回放条目；不在 TRACE_EVENT_KINDS 里的返回 undefined。
 * Design §14.2「默认不保留模型内部推理内容」：思考事件只留类型，不带文字。
 */
export function toTraceEvent(stored: TraceStoredEvent): TraceEventDto | undefined {
  const { seq, at, event } = stored;
  switch (event.kind) {
    case 'agent': {
      const a = event.event, text = a.type === 'thinking' ? undefined : a.text ?? a.result?.summary;
      return {
        seq, at: a.at, kind: 'agent', type: a.type, ...(text ? { text: clip(text) } : {}),
        ...(a.tool ? { tool: { name: a.tool.name, ...(a.tool.isError === undefined ? {} : { isError: a.tool.isError }) } } : {}),
        ...(a.status ? { status: a.status } : {}), ...(a.error ? { error: a.error.message } : {}), ...(a.sessionId ? { sessionId: a.sessionId } : {}),
        ...(a.result?.exitCode === undefined ? {} : { exitCode: a.result.exitCode }),
      };
    }
    case 'beforeStart': {
      const x = event.execution, step = x.steps.find((s) => s.stepId === (x.error?.stepId ?? x.currentStepId)) ?? x.steps.find((s) => s.state === 'failed');
      return { seq, at, kind: 'before-start', status: x.state, ...(step ? { text: step.name } : {}), ...(x.error ? { error: x.error.message } : {}) };
    }
    case 'nativeActivity': {
      const signal = event.activity.signal;
      return { seq, at: signal.occurredAt, kind: 'activity', status: signal.kind, ...(signal.nativeSessionId ? { sessionId: signal.nativeSessionId } : {}) };
    }
    case 'terminalClosed':
      return { seq, at, kind: 'terminal-closed', exitCode: event.exitCode };
    default:
      return undefined;
  }
}
