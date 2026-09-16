import type { AgentRuntimeMaterial, RuntimeCheckContext, RuntimeCheckStage, RuntimeCheckState, RuntimeDriver } from '@crewstation/contracts';

export interface CheckExecutionInput {
  readonly checkId: string;
  readonly driver: RuntimeDriver;
  readonly model: string;
  readonly material: AgentRuntimeMaterial;
  /** 固定测试内容；不带租户源码或业务数据。 */
  readonly prompt: string;
  readonly expectedReply: string;
}

/** 执行器逐阶段回报：先给出上下文（镜像、版本），再按阶段更新；同一阶段可多次更新。 */
export interface CheckProgress {
  readonly context?: Partial<RuntimeCheckContext>;
  readonly stages?: RuntimeCheckStage[];
}

export interface CheckOutcome {
  readonly state: Extract<RuntimeCheckState, 'succeeded' | 'failed' | 'cancelled' | 'unknown'>;
  readonly error?: string;
  readonly context?: Partial<RuntimeCheckContext>;
  readonly stages: RuntimeCheckStage[];
}

/**
 * 由 platform 注入 task-runtime 的实现：在平台专属短期任务里执行完整 Hook、校验最终 CLI 配置并完成一次最小模型调用。
 * 本模块（L3）只依赖端口，不 import L4。执行器必须自己清理临时任务。
 */
export interface CheckExecutor {
  run(input: CheckExecutionInput, report: (progress: CheckProgress) => Promise<void>, heartbeat: () => Promise<boolean>): Promise<CheckOutcome>;
}
