import type { BeforeStartExecution, NativeTerminalDto, NativeTerminalRecord, NativeTerminalRoster, StartupErrorCode, StartupRecord, StartupStage, StartupStageKind, TaskId, UserId } from '@crewstation/contracts';

interface StoredIdentity { taskId: TaskId; createdBy: UserId; clientRequestId: string; record: NativeTerminalRecord }

export function projectNativeTerminal(start: StoredIdentity, roster: NativeTerminalRoster | undefined, connection: NativeTerminalDto['connection'], at: string): NativeTerminalDto {
  const current = roster?.terminals.find((r) => r.agentId === start.record.agentId && r.terminalId === start.record.terminalId && r.runnerId === start.record.runnerId);
  const record = { ...(current ?? start.record), ...(start.record.computeName ? { computeName: start.record.computeName } : {}) };
  const identity = { taskId: start.taskId, createdBy: start.createdBy, clientRequestId: start.clientRequestId, connection };
  if (record.lifecycle === 'ended' || record.lifecycle === 'failed' || current) return { ...record, ...identity };
  if (roster && roster.runnerId !== record.runnerId) return { ...record, ...identity, revision: record.revision + 1, lifecycle: 'ended', endedAt: at, reason: 'runner-restarted' };
  return { ...record, ...identity, lifecycle: 'unknown' };
}

/** RFC-022：组合 CLI 六段所需的输入，全部来自持久数据，所以刷新、换人看都是同一份。 */
export interface CliStartupInput {
  /** CLI 受理时刻（dev-session 登记）：「排队分配容器」从这里算起，早于执行环境受理。 */
  readonly accepted: string;
  /** 执行环境还没受理时 exists 为 false；受理了却没有 startup 的是升级前的环境。 */
  readonly environment: { readonly exists: boolean; readonly startup?: StartupRecord };
  readonly beforeStart?: BeforeStartExecution;
  /** CLI 进程拉起的时刻：第一条 running 的 nativeTerminal 事件被平台收到的时间。 */
  readonly runningAt?: string;
  readonly record: Pick<NativeTerminalRecord, 'lifecycle' | 'reason' | 'error' | 'endedAt'>;
}

/** CLI 结束而没有哪一段写明失败时（Runner 重启、环境失败），按当时进行中的段归类。 */
const FAILURE_AT: Record<StartupStageKind, StartupErrorCode> = {
  queue: 'admission-rejected', replace: 'replace-failed', container: 'container-start-failed', checkout: 'checkout-failed', connect: 'pod-exited',
  prepare: 'before-start-failed', agent: 'agent-start-failed', ready: 'agent-start-failed',
};

const later = (start: string, end: string): string => (Date.parse(end) < Date.parse(start) ? start : end);
const span = (start: string, end: string) => { const endedAt = later(start, end); return { startedAt: start, endedAt, durationMs: Date.parse(endedAt) - Date.parse(start) }; };

/**
 * 六段：执行环境的排队分配容器／容器启动中／等待连接（task-runtime 产出）＋准备环境／Agent 启动中／已就绪（Runner 事件）。
 * 各段首尾相接；升级前受理的 CLI 返回 undefined，页面照旧显示结论。
 */
export function composeCliStartup(input: CliStartupInput): StartupRecord | undefined {
  const { environment, record, accepted } = input;
  if (environment.exists && !environment.startup) return undefined;
  const env = environment.startup;
  const container: StartupStage[] = env
    ? env.stages.filter((stage) => stage.kind !== 'ready').map((stage) => (stage.kind === 'queue' ? { ...stage, ...(stage.endedAt ? span(accepted, stage.endedAt) : { startedAt: accepted }) } : { ...stage }))
    : [{ kind: 'queue', state: 'running', startedAt: accepted }, { kind: 'container', state: 'pending' }, { kind: 'connect', state: 'pending' }];
  const connect = container.find((stage) => stage.kind === 'connect');
  const prepare = prepareStage(connect?.state === 'succeeded' ? connect.endedAt : undefined, input.beforeStart);
  // 启动前步骤被取消只在 CLI 被关闭时发生：Agent 不再启动，整体按已取消收尾。
  const agent: StartupStage = input.beforeStart?.state === 'cancelled' ? { kind: 'agent', state: 'pending' } : agentStage(prepare, input.runningAt, record);
  const ready: StartupStage = agent.state === 'succeeded' ? { kind: 'ready', state: 'succeeded', startedAt: agent.endedAt!, endedAt: agent.endedAt!, durationMs: 0 } : { kind: 'ready', state: 'pending' };
  return settle([...container, prepare, agent, ready], accepted, record, env);
}

function prepareStage(start: string | undefined, execution: BeforeStartExecution | undefined): StartupStage {
  if (!start) return { kind: 'prepare', state: 'pending' };
  if (!execution) return { kind: 'prepare', state: 'running', startedAt: start };
  const count = { done: execution.steps.filter((step) => step.state === 'succeeded').length, total: execution.steps.length };
  const end = execution.endedAt ?? start;
  if (execution.state === 'succeeded') return { kind: 'prepare', state: count.total === 0 ? 'skipped' : 'succeeded', ...span(start, end), count };
  if (execution.state === 'failed') {
    const step = execution.steps.find((item) => item.state === 'failed');
    const message = [step ? `启动前步骤「${step.name}」失败` : '启动前步骤失败', execution.error?.message].filter(Boolean).join('：');
    return { kind: 'prepare', state: 'failed', ...span(start, end), count, error: { code: 'before-start-failed', message } };
  }
  // 取消只在 CLI 被关闭时发生，整体按「已取消」收尾。
  if (execution.state === 'cancelled') return { kind: 'prepare', state: 'skipped', ...span(start, end), count };
  const current = execution.steps.find((step) => step.stepId === execution.currentStepId) ?? execution.steps.find((step) => step.state === 'running');
  return { kind: 'prepare', state: 'running', startedAt: start, count, ...(current ? { detail: current.name } : {}) };
}

function agentStage(prepare: StartupStage, runningAt: string | undefined, record: CliStartupInput['record']): StartupStage {
  if ((prepare.state !== 'succeeded' && prepare.state !== 'skipped') || !prepare.endedAt) return { kind: 'agent', state: 'pending' };
  const start = prepare.endedAt;
  if (runningAt) return { kind: 'agent', state: 'succeeded', ...span(start, runningAt) };
  if (record.lifecycle === 'failed' && record.reason === 'start-failed') return { kind: 'agent', state: 'failed', ...span(start, record.endedAt ?? start), error: { code: 'agent-start-failed', message: record.error ?? 'CLI 进程没有起来' } };
  return { kind: 'agent', state: 'running', startedAt: start, detail: '准备 CLI 配置并拉起进程' };
}

/** 整体状态：有失败即失败，已就绪即就绪；CLI 在就绪前结束时，被关闭算取消，其余把进行中的段记为失败。 */
function settle(stages: StartupStage[], accepted: string, record: CliStartupInput['record'], env: StartupRecord | undefined): StartupRecord {
  const failed = stages.find((stage) => stage.state === 'failed');
  if (failed) return { state: 'failed', startedAt: accepted, endedAt: failed.endedAt ?? record.endedAt ?? accepted, stages };
  const ready = stages.at(-1)!;
  if (ready.state === 'succeeded') return { state: 'ready', startedAt: accepted, endedAt: ready.endedAt!, stages };
  const ended = record.lifecycle === 'ended' || record.lifecycle === 'failed';
  if (!ended && env?.state !== 'cancelled') return { state: 'running', startedAt: accepted, stages };
  const at = record.endedAt ?? env?.endedAt ?? accepted;
  const running = stages.findIndex((stage) => stage.state === 'running');
  if (record.reason === 'stopped' || env?.state === 'cancelled') {
    const next = stages.map((stage, i) => (i === running && stage.startedAt ? { ...stage, state: 'skipped' as const, ...span(stage.startedAt, at) } : stage));
    return { state: 'cancelled', startedAt: accepted, endedAt: at, stages: next };
  }
  const index = running >= 0 ? running : stages.findIndex((stage) => stage.state === 'pending');
  const target = stages[index]!;
  const failedStage: StartupStage = { ...target, state: 'failed', ...(target.startedAt ? span(target.startedAt, at) : { startedAt: at, endedAt: at, durationMs: 0 }), error: { code: FAILURE_AT[target.kind], message: record.error ?? '启动没有完成' } };
  return { state: 'failed', startedAt: accepted, endedAt: at, stages: stages.map((stage, i) => (i === index ? failedStage : stage)) };
}
