import type { AgentProfile, OutputContract, ProfileRevisionRef, SubtaskId, SubtaskMode, SubtaskState, TaskId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

export interface ContractCheck { ok: boolean; missing: string[]; schemaErrors: string[] }

/** 子任务运行：Agent 子任务带登记过的 agentProfile 与 outputContract 快照，命令子任务带命令；attempt 每次重试递增，不覆盖失败证据。 */
export interface SubtaskRun {
  readonly id: SubtaskId;
  readonly taskId: TaskId;
  readonly name: string;
  readonly kind: 'agent' | 'command';
  readonly mode?: SubtaskMode;
  readonly state: SubtaskState;
  readonly attempt: number;
  readonly prompt?: string;
  readonly cwd?: string;
  readonly command?: string[];
  readonly timeoutSeconds?: number;
  readonly agentProfile?: AgentProfile;
  readonly outputContract?: OutputContract;
  /** RFC-006：本次 attempt 固定的算力档位修订（`default` 已解析成真实名称）；构造时解析失败则在首次派发时再解析。 */
  readonly computeProfile?: ProfileRevisionRef;
  /** TaskRunner 侧的关联 ID（agentId 或 execId）。 */
  readonly runnerRef?: string;
  readonly sessionId?: string;
  readonly exitCode?: number;
  readonly output?: string;
  readonly businessOutcome?: string;
  readonly contractResult?: ContractCheck;
  readonly error?: string;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly endedAt?: Date;
}

const NEXT: Record<SubtaskState, readonly SubtaskState[]> = {
  pending: ['running', 'failed', 'cancelled'],
  running: ['awaiting-input', 'verifying', 'succeeded', 'failed', 'cancelled'],
  'awaiting-input': ['running', 'verifying', 'succeeded', 'failed', 'cancelled'],
  verifying: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export const TERMINAL: readonly SubtaskState[] = ['succeeded', 'failed', 'cancelled'];

export function transition(run: SubtaskRun, state: SubtaskState, now: Date, patch: Partial<SubtaskRun> = {}): SubtaskRun {
  if (!NEXT[run.state].includes(state)) throw precondition(`子任务 ${run.name} 不能从 ${run.state} 进入 ${state}`);
  return { ...run, ...patch, state, ...(TERMINAL.includes(state) ? { endedAt: now } : {}) };
}

export function isTerminal(run: SubtaskRun): boolean {
  return TERMINAL.includes(run.state);
}

/** 契约通过才算成功；业务语义（findings 等）由业务写入 businessOutcome，不等于失败（AT-26）。 */
export function outcomeOfContract(check: ContractCheck): SubtaskState {
  return check.ok ? 'succeeded' : 'failed';
}
