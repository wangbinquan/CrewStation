import type { AgentProtocol, BeforeStartStep, ProfileTestContext, ProfileTestId, ProfileTestOutcome, ProfileTestStage, ProfileTestState, UserId } from '@crewstation/contracts';

/**
 * 一次档位测试（RFC-006 §8）：绑定精确修订与内容哈希。保存出新修订时旧修订上未结束的测试作废（superseded）；
 * 测试环境中途丢失记 unknown，不自动重跑有副作用的启动前脚本。
 */
export interface ProfileTest {
  readonly testId: ProfileTestId;
  readonly profile: string;
  readonly revision: number;
  readonly contentHash: string;
  readonly trigger: 'save' | 'manual';
  readonly clientRequestId?: string;
  readonly createdBy: UserId;
  readonly state: ProfileTestState;
  readonly outcome?: ProfileTestOutcome;
  readonly context: ProfileTestContext;
  readonly stages: ProfileTestStage[];
  readonly error?: string;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly endedAt?: Date;
}

export const TEST_STAGE = { image: 'image', runner: 'runner', launch: 'launch', model: 'model', command: 'command' } as const;
export const stepStageId = (stepId: string): string => `step:${stepId}`;

/** 阶段表与步骤表一一对应，先全部 pending；真实进度由执行器逐阶段更新。 */
export function initialStages(protocol: AgentProtocol, steps: readonly Pick<BeforeStartStep, 'stepId' | 'name'>[]): ProfileTestStage[] {
  return [
    { id: TEST_STAGE.image, kind: 'image', name: '拉取镜像', state: 'pending' },
    { id: TEST_STAGE.runner, kind: 'runner', name: 'Runner 握手', state: 'pending' },
    ...steps.map((step): ProfileTestStage => ({ id: stepStageId(step.stepId), kind: 'step', name: step.name, stepId: step.stepId, state: 'pending' })),
    ...(protocol === 'terminal'
      ? [{ id: TEST_STAGE.command, kind: 'command' as const, name: '测试命令', state: 'pending' as const }]
      : [{ id: TEST_STAGE.launch, kind: 'launch' as const, name: '启动 CLI', state: 'pending' as const }, { id: TEST_STAGE.model, kind: 'model' as const, name: '真实模型轮次', state: 'pending' as const }]),
  ];
}

export function isTestTerminal(state: ProfileTestState): boolean {
  return state === 'passed' || state === 'failed' || state === 'unknown' || state === 'superseded';
}

/** 合并执行器回报的阶段：同 id 覆盖，新 id 追加，顺序保持首次出现的位置。 */
export function mergeStages(current: readonly ProfileTestStage[], updates: readonly ProfileTestStage[] | undefined): ProfileTestStage[] {
  if (!updates?.length) return [...current];
  const merged = [...current];
  for (const update of updates) {
    const at = merged.findIndex((s) => s.id === update.id);
    if (at >= 0) merged[at] = update; else merged.push(update);
  }
  return merged;
}

/** 测试以失败或无法确认收尾时，没走到的阶段记为「跳过」，不留一排「等待中」让人以为还在跑（2026-09-18 实机所见）。 */
export function skipUnreachedStages(stages: readonly ProfileTestStage[]): ProfileTestStage[] {
  return stages.map((s) => (s.state === 'pending' ? { ...s, state: 'skipped' as const } : s));
}

/**
 * 固定测试内容：不带租户源码或业务数据；每次一个新的随机 nonce，回文里必须原样出现才算真实模型轮次（agent-workflow 的判定）。
 */
export function testPrompt(): { prompt: string; expectedReply: string } {
  const nonce = `crewstation-test-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  return { prompt: `Output this exact token verbatim and nothing else: ${nonce}`, expectedReply: nonce };
}

const OUTCOME_SENTENCE: Record<ProfileTestOutcome, string> = {
  passed: '测试通过',
  'image-pull-failed': '镜像拉取失败，请确认镜像已推到平台仓库且摘要未被删除',
  'runner-unavailable': '镜像里没有可用的 TaskRunner，请基于平台底座镜像构建',
  'runner-protocol-mismatch': '镜像里的 TaskRunner 协议版本与平台不一致，请基于当前底座镜像重建',
  'before-start-failed': '启动前步骤失败',
  'spawn-failed': '二进制无法启动，请核对二进制路径与镜像内容',
  'auth-missing': 'CLI 已启动但鉴权失败，请核对凭据',
  'network-blocked': 'CLI 已启动但连不上模型端点，请核对网络、代理或出站白名单',
  'model-call-failed': 'CLI 已鉴权但模型调用失败（限流、不可用或无权使用该模型）',
  'stream-nonconforming': 'CLI 的输出不符合所选协议，或没有原样回显测试标记',
  'output-mismatch': '测试命令的输出与期望不符',
  timeout: '测试超时',
  'environment-lost': '测试环境中途丢失，无法确认结果',
};

export const outcomeSentence = (outcome: ProfileTestOutcome): string => OUTCOME_SENTENCE[outcome];
