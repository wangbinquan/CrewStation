import type { AgentEvent, BeforeStartExecution, BeforeStartStepRecord, RuntimeCheckStage, RuntimeCheckStageState } from '@crewstation/contracts';

/** 与 agent-runtime 的阶段编号约定一致：input / step:<stepId> / cli-config / model。 */
export const STAGE = { input: 'input', cliConfig: 'cli-config', model: 'model' } as const;
export const stepStageId = (stepId: string): string => `step:${stepId}`;

const STEP_STATE: Record<BeforeStartStepRecord['state'], RuntimeCheckStageState> = { pending: 'pending', running: 'running', succeeded: 'succeeded', failed: 'failed', skipped: 'skipped', cancelled: 'skipped' };

/** 每个 Hook 步骤记录 → 一个检查阶段；路径、退出码与输出变量名进 detail，脚本输出尾部只在检查里保留。 */
export function stagesFromBeforeStart(execution: BeforeStartExecution): RuntimeCheckStage[] {
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

export interface ModelProbe {
  /** 已看到 CLI 进程创建（started）。 */
  started: boolean;
  text: string;
  outcome?: { kind: 'completed' | 'error' | 'cancelled'; message?: string; code?: string; at: string };
}

/** 逐条吸收 Agent 事件；只关心是否真的拿到了模型回文。 */
export function absorbAgentEvent(probe: ModelProbe, event: AgentEvent): ModelProbe {
  switch (event.type) {
    case 'started': return { ...probe, started: true };
    case 'text': return { ...probe, text: (probe.text + (event.text ?? '')).slice(0, 4096) };
    case 'completed': return { ...probe, outcome: { kind: 'completed', at: event.at } };
    case 'error': return { ...probe, outcome: { kind: 'error', message: event.error?.message ?? 'Agent 报错', code: event.error?.code, at: event.at } };
    case 'cancelled': return { ...probe, outcome: { kind: 'cancelled', at: event.at } };
    default: return probe;
  }
}

/** 配置合成失败由驱动以 cli_config_invalid／driver_setup_failed 报出；其余错误归为模型阶段。 */
export function cliConfigStage(probe: ModelProbe): RuntimeCheckStage | undefined {
  if (probe.outcome?.kind === 'error' && (probe.outcome.code === 'cli_config_invalid' || probe.outcome.code === 'driver_setup_failed' || probe.outcome.code === 'before_start_failed')) {
    return { id: STAGE.cliConfig, kind: 'cli-config', name: '最终 CLI 配置校验', state: 'failed', endedAt: probe.outcome.at, error: { code: probe.outcome.code === 'before_start_failed' ? 'internal_error' : 'cli_config_invalid', message: probe.outcome.message ?? '' } };
  }
  if (probe.started) return { id: STAGE.cliConfig, kind: 'cli-config', name: '最终 CLI 配置校验', state: 'succeeded', detail: 'CLI 进程已按合成后的配置创建' };
  return undefined;
}

/** 模型阶段：只有回文里出现约定标记才算通过；读到目录、启动了 TUI 都不算。 */
export function modelStage(probe: ModelProbe, expectedReply: string): RuntimeCheckStage {
  const base = { id: STAGE.model, kind: 'model' as const, name: '真实模型响应' };
  if (!probe.outcome) return { ...base, state: probe.started ? 'running' : 'pending' };
  if (probe.outcome.kind === 'cancelled') return { ...base, state: 'skipped', endedAt: probe.outcome.at, detail: '检查被取消' };
  if (probe.outcome.kind === 'error') return { ...base, state: 'failed', endedAt: probe.outcome.at, error: { code: 'script_failed', message: probe.outcome.message ?? '' }, detail: excerpt(probe.text) };
  if (probe.text.includes(expectedReply)) return { ...base, state: 'succeeded', endedAt: probe.outcome.at, detail: `模型返回了约定标记 ${expectedReply}` };
  return { ...base, state: 'failed', endedAt: probe.outcome.at, error: { code: 'script_failed', message: '模型有响应但没有返回约定标记；请核对模型名与网关' }, detail: excerpt(probe.text) };
}

function excerpt(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed ? `回文摘录：${trimmed.slice(0, 200)}` : undefined;
}
