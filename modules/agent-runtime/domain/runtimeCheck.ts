import type { RuntimeCheckContext, RuntimeCheckId, RuntimeCheckStage, RuntimeCheckState, RuntimeConfigId, UserId } from '@crewstation/contracts';
import type { RuntimeRevision } from './runtimeConfig';

/** 一次运行环境检查：绑定精确版本与 contentHash；编辑后旧检查不能用于启用新内容。 */
export interface RuntimeCheck {
  readonly checkId: RuntimeCheckId;
  readonly configId: RuntimeConfigId;
  readonly revision: number;
  readonly contentHash: string;
  readonly clientRequestId: string;
  readonly createdBy: UserId;
  readonly model?: string;
  readonly state: RuntimeCheckState;
  readonly context: RuntimeCheckContext;
  readonly stages: RuntimeCheckStage[];
  readonly error?: string;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly endedAt?: Date;
}

export const CHECK_STAGE_IDS = { input: 'input', cliConfig: 'cli-config', model: 'model' } as const;
export const stepStageId = (stepId: string): string => `step:${stepId}`;

/** 阶段表与步骤表一一对应，先全部 pending；真实进度由执行器逐阶段更新。 */
export function initialStages(revision: Pick<RuntimeRevision, 'steps'>): RuntimeCheckStage[] {
  return [
    { id: CHECK_STAGE_IDS.input, kind: 'input', name: '输入校验', state: 'pending' },
    ...revision.steps.map((step): RuntimeCheckStage => ({ id: stepStageId(step.stepId), kind: 'step', name: step.name, stepId: step.stepId, state: 'pending' })),
    { id: CHECK_STAGE_IDS.cliConfig, kind: 'cli-config', name: '最终 CLI 配置校验', state: 'pending' },
    { id: CHECK_STAGE_IDS.model, kind: 'model', name: '真实模型响应', state: 'pending' },
  ];
}

export function isCheckTerminal(state: RuntimeCheckState): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'cancelled' || state === 'unknown';
}

/** 启用只接受同配置、同版本、同内容且已通过的检查。 */
export function checkUsableFor(check: RuntimeCheck | undefined, revision: RuntimeRevision): { ok: true } | { ok: false; reason: string } {
  if (!check) return { ok: false, reason: '检查记录不存在' };
  if (check.configId !== revision.configId || check.revision !== revision.revision) return { ok: false, reason: `检查 ${check.checkId} 针对的不是版本 ${revision.revision}` };
  if (check.contentHash !== revision.contentHash) return { ok: false, reason: '检查时的内容与当前版本不一致' };
  if (check.state !== 'succeeded') return { ok: false, reason: `检查状态为 ${check.state}，只有通过的检查才能启用` };
  return { ok: true };
}
