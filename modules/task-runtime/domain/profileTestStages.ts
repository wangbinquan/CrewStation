import type { AgentEvent, BeforeStartExecution, BeforeStartStepRecord, ProbeTerminalResult, ProfileTestOutcome, ProfileTestStage, ProfileTestStageState, StartupRecord } from '@crewstation/contracts';
import { maskDiagnosticsText, outputTail } from './diagnosticsText';
import { classifyProtocolFailure } from './profileTestClassifier';

/**
 * 与 agent-runtime 的阶段编号约定一致（RFC-022 起）：queue / container / connect（公共的前三段）/ step:<stepId> / agent / model / command。
 * 之前的记录是 image / runner / launch，只读显示。
 */
export const TEST_STAGE = { agent: 'agent', model: 'model', command: 'command' } as const;
export const stepStageId = (stepId: string): string => `step:${stepId}`;

const STEP_STATE: Record<BeforeStartStepRecord['state'], ProfileTestStageState> = { pending: 'pending', running: 'running', succeeded: 'succeeded', failed: 'failed', skipped: 'skipped', cancelled: 'skipped' };

type ContainerKind = 'queue' | 'container' | 'connect';
const CONTAINER_STAGE: Record<ContainerKind, string> = { queue: '排队分配容器', container: '容器启动中（调度、拉取镜像）', connect: '容器已启动，等待连接' };
const isContainerKind = (kind: string): kind is ContainerKind => kind in CONTAINER_STAGE;

/**
 * RFC-022 D8：测试的前三段直接取测试环境自己的启动进度（与 CLI、开发会话同一套，由启动观测维护）。
 * 给出 failure 时，把进行中（没有就是第一个未开始）的那段记为失败，写明归类与原因；测试自己的判定规则不变。
 */
export function containerStagesForTest(startup: StartupRecord | undefined, failure?: { code: string; message: string }, detail?: { connect?: string }): ProfileTestStage[] {
  const stages = (startup?.stages ?? [{ kind: 'queue' as const, state: 'running' as const }, { kind: 'container' as const, state: 'pending' as const }, { kind: 'connect' as const, state: 'pending' as const }])
    .filter((stage) => isContainerKind(stage.kind));
  const current = stages.findIndex((stage) => stage.state === 'running' || stage.state === 'failed');
  const failAt = !failure ? -1 : current >= 0 ? current : stages.findIndex((stage) => stage.state === 'pending');
  return stages.map((stage, index): ProfileTestStage => {
    const { error, logTail: _log, kind, ...rest } = stage, name = CONTAINER_STAGE[kind as ContainerKind];
    const base: ProfileTestStage = { ...rest, id: kind, kind, name, ...(kind === 'connect' && detail?.connect && stage.state === 'succeeded' ? { detail: detail.connect } : {}) };
    if (index === failAt && failure) return { ...base, state: 'failed', error: { code: failure.code, message: failure.message } };
    return error ? { ...base, error: { code: error.code, message: error.message } } : base;
  });
}

/** 每个启动前步骤记录 → 一个测试阶段；路径、退出码与输出变量名进 detail，脚本输出尾部只在测试里保留。 */
export function stagesFromBeforeStart(execution: BeforeStartExecution): ProfileTestStage[] {
  return execution.steps.map((step) => {
    const details = [step.path ? (step.kind === 'file' ? `落点 ${step.path}` : `工作目录 ${step.path}`) : undefined, step.exitCode === undefined || step.exitCode === null ? undefined : `退出码 ${step.exitCode}`,
      step.outputVariables?.length ? `输出变量 ${step.outputVariables.join('、')}` : undefined].filter((d): d is string => !!d);
    return {
      id: stepStageId(step.stepId), kind: 'step', name: step.name, stepId: step.stepId, state: STEP_STATE[step.state],
      ...(step.startedAt ? { startedAt: step.startedAt } : {}), ...(step.endedAt ? { endedAt: step.endedAt } : {}), ...(step.durationMs === undefined ? {} : { durationMs: step.durationMs }),
      ...(details.length ? { detail: details.join('；') } : {}), ...(step.exitCode === undefined ? {} : { exitCode: step.exitCode }), ...(step.log ? { log: step.log } : {}), ...(step.error ? { error: step.error } : {}),
    };
  });
}

/** 一次协议测试轮次的观测：是否起了进程、原生会话 ID、回文、CLI 原始输出的尾部与终态。 */
export interface ProtocolProbe {
  started: boolean;
  /** 进程拉起的时刻（started 事件）：「Agent 启动中」到此结束、「真实模型轮次」从此开始。 */
  startedAt?: string;
  sessionId?: string;
  text: string;
  /**
   * 事件携带的 CLI 原始行（stdout 的逐行 JSON）拼成的有界尾部。agent-workflow 的冒烟对 stdout／stderr 原文做分类并随原因给出摘录；
   * 这里的等价物是事件的 raw——归一后的错误文案只是一句概括（opencode 的 error 行由驱动提取厂商文案，别的 CLI 或字段形状变化时仍可能只剩「运行时报告错误」），原文以 raw 为准。
   */
  diagnostics: string;
  outcome?: { kind: 'completed' | 'error' | 'cancelled'; message?: string; code?: string; exitCode?: number | null; at: string };
}

/** 逐条吸收 Agent 事件；只关心进程、会话、回文与终态。 */
export function absorbAgentEvent(probe: ProtocolProbe, event: AgentEvent): ProtocolProbe {
  const withSession = event.sessionId && !probe.sessionId ? { ...probe, sessionId: event.sessionId } : probe;
  // started 事件的 raw 是驱动自己的启动规格，不是 CLI 输出，不进原文尾部。
  const raw = event.type === 'started' ? undefined : rawLineOf(event.raw);
  const next = raw ? { ...withSession, diagnostics: `${withSession.diagnostics}${raw}\n`.slice(-DIAGNOSTICS_CAP) } : withSession;
  switch (event.type) {
    case 'started': return { ...next, started: true, startedAt: next.startedAt ?? event.at };
    case 'text': return { ...next, text: (next.text + (event.text ?? '')).slice(-8192) };
    case 'completed': return { ...next, outcome: { kind: 'completed', exitCode: event.result?.exitCode ?? null, at: event.at } };
    case 'error': return { ...next, outcome: { kind: 'error', message: event.error?.message ?? 'Agent 报错', ...(event.error?.code ? { code: event.error.code } : {}), at: event.at } };
    case 'cancelled': return { ...next, outcome: { kind: 'cancelled', at: event.at } };
    default: return next;
  }
}

const DIAGNOSTICS_CAP = 8192;
const EVIDENCE_CAP = 600;

function rawLineOf(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw.trim() || undefined;
  if (raw === undefined || raw === null) return undefined;
  try { return JSON.stringify(raw); } catch { return undefined; }
}

/** 驱动在创建 CLI 进程之前就失败的错误码：二进制不存在、起不来或参数装配失败，不是模型的问题。 */
const LAUNCH_FAILURES = new Set(['driver_not_installed', 'spawn_failed', 'driver_setup_failed', 'cli_config_invalid']);

/** 段的起止与用时：两端都知道才算用时（迁到公共步骤条后，这两段原来没有时间，显示上缺一格，RFC-022 实机）。 */
function timed(from: string | undefined, to: string | undefined): Pick<ProfileTestStage, 'startedAt' | 'endedAt' | 'durationMs'> {
  const duration = from && to ? Math.max(0, Date.parse(to) - Date.parse(from)) : undefined;
  return { ...(from ? { startedAt: from } : {}), ...(to ? { endedAt: to } : {}), ...(duration === undefined ? {} : { durationMs: duration }) };
}

/** from：这一段开始的时刻（启动前步骤结束，没有步骤时是发出启动命令的时刻）。 */
export function launchStage(probe: ProtocolProbe, beforeStartDone: boolean, from?: string): ProfileTestStage {
  const base = { id: TEST_STAGE.agent, kind: 'agent' as const, name: 'Agent 启动中' };
  if (probe.outcome?.kind === 'error' && probe.outcome.code && LAUNCH_FAILURES.has(probe.outcome.code)) {
    return { ...base, state: 'failed', ...timed(from, probe.outcome.at), error: { code: probe.outcome.code, message: probe.outcome.message ?? '' } };
  }
  if (probe.started) return { ...base, state: 'succeeded', ...timed(from, probe.startedAt), detail: 'CLI 进程已按档位的二进制与参数创建' };
  if (probe.outcome) return { ...base, state: 'skipped' };
  return beforeStartDone ? { ...base, state: 'running', ...timed(from, undefined) } : { ...base, state: 'pending' };
}

/** 通过条件（agent-workflow 的判定）：退出码 0、捕获到原生会话 ID、回文里原样出现 nonce。 */
export function conforms(probe: ProtocolProbe, expectedReply: string): boolean {
  return probe.outcome?.kind === 'completed' && (probe.outcome.exitCode ?? 0) === 0 && !!probe.sessionId && probe.text.includes(expectedReply);
}

export interface ModelVerdict { stage: ProfileTestStage; outcome?: ProfileTestOutcome; error?: string }

/**
 * 模型阶段：没通过时按移植的正则分类；timedOut 由执行器在截止时间到了仍无终态时给出。
 * 分类的语料与 agent-workflow 一致取 CLI 原文（错误文案＋回文＋原始行尾部）；失败原因后面附一段打码后的原文摘录，
 * 与源的 withEvidence 同义。knownSecrets 是这次测试材料里的凭据值，摘录前替换掉。
 */
export function modelVerdict(probe: ProtocolProbe, expectedReply: string, timedOut: boolean, modelConfigured: boolean, knownSecrets: readonly string[] = []): ModelVerdict {
  const base = { id: TEST_STAGE.model, kind: 'model' as const, name: '真实模型轮次' };
  if (!probe.outcome && !timedOut) return { stage: probe.started ? { ...base, state: 'running', ...timed(probe.startedAt, undefined) } : { ...base, state: 'pending' } };
  if (probe.outcome?.kind === 'cancelled') return { stage: { ...base, state: 'skipped', endedAt: probe.outcome.at, detail: '测试被取消' } };
  if (probe.outcome?.kind === 'error' && probe.outcome.code && LAUNCH_FAILURES.has(probe.outcome.code)) return { stage: { ...base, state: 'skipped' }, outcome: 'spawn-failed', error: probe.outcome.message ?? '二进制无法启动' };
  if (probe.outcome?.kind === 'error' && probe.outcome.code === 'before_start_failed') return { stage: { ...base, state: 'skipped' }, outcome: 'before-start-failed', error: probe.outcome.message ?? '启动前步骤失败' };
  if (conforms(probe, expectedReply)) return { stage: { ...base, state: 'succeeded', ...timed(probe.startedAt, probe.outcome!.at), detail: `捕获到会话 ${probe.sessionId}，模型原样回显了测试标记` } };
  const outcome = classifyProtocolFailure({ timedOut: timedOut && !probe.outcome, haystack: `${probe.outcome?.message ?? ''}\n${probe.text}\n${probe.diagnostics}` });
  const reasons = [
    probe.outcome ? undefined : '在时限内没有结束',
    probe.outcome?.kind === 'error' ? probe.outcome.message : undefined,
    probe.outcome && !probe.sessionId ? '没有捕获到原生会话 ID' : undefined,
    probe.outcome && !probe.text.includes(expectedReply) ? '回文里没有测试标记' : undefined,
    probe.outcome?.kind === 'completed' && (probe.outcome.exitCode ?? 0) !== 0 ? `退出码 ${probe.outcome.exitCode}` : undefined,
    // agent-workflow 的提示：没配模型时二进制用自己的默认模型，私有网关常常没开通它。
    !modelConfigured && (outcome === 'model-call-failed' || outcome === 'stream-nonconforming') ? '档位没有填写模型，二进制使用了自己的默认模型；请填写模型后重测' : undefined,
  ].filter((r): r is string => !!r);
  const evidence = outputTail(maskDiagnosticsText(probe.diagnostics, knownSecrets), EVIDENCE_CAP);
  const message = `${reasons.join('；') || '协议轮次没有完成'}${evidence ? ` — CLI 原文：${evidence}` : ''}`;
  const log = probe.diagnostics ? { log: { stdoutTail: maskDiagnosticsText(probe.diagnostics, knownSecrets).slice(-4000), stderrTail: maskDiagnosticsText(probe.outcome?.message ?? '', knownSecrets) } } : {};
  return { stage: { ...base, state: 'failed', ...timed(probe.startedAt, probe.outcome?.at), error: { code: outcome, message }, ...log, ...(excerpt(probe.text) ? { detail: excerpt(probe.text) } : {}) }, outcome, error: message };
}

/** 通用终端的测试命令阶段：退出码 0 且输出匹配期望正则才算通过（C11）。 */
export function commandVerdict(result: ProbeTerminalResult['command'], expect: string): ModelVerdict {
  const base = { id: TEST_STAGE.command, kind: 'command' as const, name: '测试命令' };
  if (!result) return { stage: { ...base, state: 'skipped' } };
  const tail = { log: { stdoutTail: result.outputTail, stderrTail: '' }, exitCode: result.exitCode, durationMs: result.durationMs };
  if (result.spawnError) return { stage: { ...base, state: 'failed', ...tail, error: { code: 'spawn-failed', message: result.spawnError } }, outcome: 'spawn-failed', error: `测试命令无法启动：${result.spawnError}` };
  if (result.timedOut) return { stage: { ...base, state: 'failed', ...tail, error: { code: 'timeout', message: '测试命令超时' } }, outcome: 'timeout', error: '测试命令超时' };
  if (result.exitCode !== 0) return { stage: { ...base, state: 'failed', ...tail, error: { code: 'output-mismatch', message: `测试命令退出码 ${result.exitCode}` } }, outcome: 'output-mismatch', error: `测试命令退出码 ${result.exitCode}` };
  if (!result.matched) return { stage: { ...base, state: 'failed', ...tail, error: { code: 'output-mismatch', message: `输出不匹配期望正则 ${expect}` } }, outcome: 'output-mismatch', error: `输出不匹配期望正则 ${expect}` };
  return { stage: { ...base, state: 'succeeded', ...tail, detail: `退出码 0，输出匹配 ${expect}` } };
}

function excerpt(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed ? `回文摘录：${trimmed.slice(0, 200)}` : undefined;
}
