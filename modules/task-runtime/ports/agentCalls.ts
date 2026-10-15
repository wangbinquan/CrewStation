import type { TaskId } from '@crewstation/contracts';

/** 档位测试的一次模型执行：协议轮次，或业务执行能力实测中的一轮。 */
export interface ProfileTestCall {
  readonly testId: string;
  readonly runtimeTaskId: TaskId;
  readonly agentId: string;
  readonly step: 'protocol' | 'business';
  readonly profile: { readonly id: string; readonly revision: number };
  readonly protocol: string;
}

/**
 * RFC-034 v2 §4：档位测试的模型执行在派发前受理一条平台 Agent 执行记录（不属于项目），用量与终态由
 * Session 按 Runner 事件转交；测试环境释放后仍在运行的由 observability 记为中断。组合根接到 observability。
 */
export interface ProfileTestCalls {
  /** 失败时不派发这次执行。 */
  accept(call: ProfileTestCall): Promise<void>;
}
