import type { AgentEvent, BeforeStartExecution, BeforeStartStepRecord, ProbeTerminalResult, ProfileTestOutcome, ProfileTestStage, ProfileTestStageState } from '@crewstation/contracts';
import { classifyProtocolFailure } from './profileTestClassifier';

/** 与 agent-runtime 的阶段编号约定一致：image / runner / step:<stepId> / launch / model / command。 */
export const TEST_STAGE = { image: 'image', runner: 'runner', launch: 'launch', model: 'model', command: 'command' } as const;
export const stepStageId = (stepId: string): string => `step:${stepId}`;

const STEP_STATE: Record<BeforeStartStepRecord['state'], ProfileTestStageState> = { pending: 'pending', running: 'running', succeeded: 'succeeded', failed: 'failed', skipped: 'skipped', cancelled: 'skipped' };

export const imageStage = (state: ProfileTestStageState, patch: Partial<ProfileTestStage> = {}): ProfileTestStage => ({ id: TEST_STAGE.image, kind: 'image', name: '拉取镜像', state, ...patch });
export const runnerStage = (state: ProfileTestStageState, patch: Partial<ProfileTestStage> = {}): ProfileTestStage => ({ id: TEST_STAGE.runner, kind: 'runner', name: 'Runner 握手', state, ...patch });

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

/** 一次协议测试轮次的观测：是否起了进程、原生会话 ID、回文与终态。 */
export interface ProtocolProbe {
  started: boolean;
  sessionId?: string;
  text: string;
  outcome?: { kind: 'completed' | 'error' | 'cancelled'; message?: string; code?: string; exitCode?: number | null; at: string };
}

/** 逐条吸收 Agent 事件；只关心进程、会话、回文与终态。 */
export function absorbAgentEvent(probe: ProtocolProbe, event: AgentEvent): ProtocolProbe {
  const next = event.sessionId && !probe.sessionId ? { ...probe, sessionId: event.sessionId } : probe;
  switch (event.type) {
    case 'started': return { ...next, started: true };
    case 'text': return { ...next, text: (next.text + (event.text ?? '')).slice(-8192) };
    case 'completed': return { ...next, outcome: { kind: 'completed', exitCode: event.result?.exitCode ?? null, at: event.at } };
    case 'error': return { ...next, outcome: { kind: 'error', message: event.error?.message ?? 'Agent 报错', ...(event.error?.code ? { code: event.error.code } : {}), at: event.at } };
    case 'cancelled': return { ...next, outcome: { kind: 'cancelled', at: event.at } };
    default: return next;
  }
}

/** 驱动在创建 CLI 进程之前就失败的错误码：二进制起不来或参数装配失败，不是模型的问题。 */
const LAUNCH_FAILURES = new Set(['spawn_failed', 'driver_setup_failed', 'cli_config_invalid']);

export function launchStage(probe: ProtocolProbe, beforeStartDone: boolean): ProfileTestStage {
  const base = { id: TEST_STAGE.launch, kind: 'launch' as const, name: '启动 CLI' };
  if (probe.outcome?.kind === 'error' && probe.outcome.code && LAUNCH_FAILURES.has(probe.outcome.code)) {
    return { ...base, state: 'failed', endedAt: probe.outcome.at, error: { code: probe.outcome.code, message: probe.outcome.message ?? '' } };
  }
  if (probe.started) return { ...base, state: 'succeeded', detail: 'CLI 进程已按档位的二进制与参数创建' };
  if (probe.outcome) return { ...base, state: 'skipped' };
  return { ...base, state: beforeStartDone ? 'running' : 'pending' };
}

/** 通过条件（agent-workflow 的判定）：退出码 0、捕获到原生会话 ID、回文里原样出现 nonce。 */
export function conforms(probe: ProtocolProbe, expectedReply: string): boolean {
  return probe.outcome?.kind === 'completed' && (probe.outcome.exitCode ?? 0) === 0 && !!probe.sessionId && probe.text.includes(expectedReply);
}

export interface ModelVerdict { stage: ProfileTestStage; outcome?: ProfileTestOutcome; error?: string }

/** 模型阶段：没通过时按移植的正则分类；timedOut 由执行器在截止时间到了仍无终态时给出。 */
export function modelVerdict(probe: ProtocolProbe, expectedReply: string, timedOut: boolean, modelConfigured: boolean): ModelVerdict {
  const base = { id: TEST_STAGE.model, kind: 'model' as const, name: '真实模型轮次' };
  if (!probe.outcome && !timedOut) return { stage: { ...base, state: probe.started ? 'running' : 'pending' } };
  if (probe.outcome?.kind === 'cancelled') return { stage: { ...base, state: 'skipped', endedAt: probe.outcome.at, detail: '测试被取消' } };
  if (probe.outcome?.kind === 'error' && probe.outcome.code && LAUNCH_FAILURES.has(probe.outcome.code)) return { stage: { ...base, state: 'skipped' }, outcome: 'spawn-failed', error: probe.outcome.message ?? '二进制无法启动' };
  if (probe.outcome?.kind === 'error' && probe.outcome.code === 'before_start_failed') return { stage: { ...base, state: 'skipped' }, outcome: 'before-start-failed', error: probe.outcome.message ?? '启动前步骤失败' };
  if (conforms(probe, expectedReply)) return { stage: { ...base, state: 'succeeded', endedAt: probe.outcome!.at, detail: `捕获到会话 ${probe.sessionId}，模型原样回显了测试标记` } };
  const outcome = classifyProtocolFailure({ timedOut: timedOut && !probe.outcome, haystack: `${probe.outcome?.message ?? ''}\n${probe.text}` });
  const reasons = [
    probe.outcome ? undefined : '在时限内没有结束',
    probe.outcome?.kind === 'error' ? probe.outcome.message : undefined,
    probe.outcome && !probe.sessionId ? '没有捕获到原生会话 ID' : undefined,
    probe.outcome && !probe.text.includes(expectedReply) ? '回文里没有测试标记' : undefined,
    probe.outcome?.kind === 'completed' && (probe.outcome.exitCode ?? 0) !== 0 ? `退出码 ${probe.outcome.exitCode}` : undefined,
    // agent-workflow 的提示：没配模型时二进制用自己的默认模型，私有网关常常没开通它。
    !modelConfigured && (outcome === 'model-call-failed' || outcome === 'stream-nonconforming') ? '档位没有填写模型，二进制使用了自己的默认模型；请填写模型后重测' : undefined,
  ].filter((r): r is string => !!r);
  const message = reasons.join('；') || '协议轮次没有完成';
  return { stage: { ...base, state: 'failed', ...(probe.outcome ? { endedAt: probe.outcome.at } : {}), error: { code: outcome, message }, ...(excerpt(probe.text) ? { detail: excerpt(probe.text) } : {}) }, outcome, error: message };
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
