import type { BeforeStartMaterial, LaunchSpec, ProfileTestContext, ProfileTestOutcome, ProfileTestStage, TerminalTest } from '@crewstation/contracts';

export interface ProfileTestInput {
  readonly testId: string;
  readonly profile: string;
  readonly revision: number;
  readonly launch: LaunchSpec;
  /** 按摘要固定的镜像引用：测试与真实启动拉的是同一份镜像。 */
  readonly image: string;
  readonly taskProfile?: string;
  /** captureOutput 为 true：测试保留脚本输出尾部供管理员定位。 */
  readonly beforeStart: BeforeStartMaterial;
  /** 已知协议：发给 CLI 的固定提示与必须原样回显的 nonce。 */
  readonly prompt: string;
  readonly expectedReply: string;
  /** 通用终端协议的测试命令。 */
  readonly terminalTest?: TerminalTest;
}

/** 执行器逐阶段回报：先给出上下文（镜像摘要、Runner 协议、CLI 版本），再按阶段更新；同一阶段可多次更新。 */
export interface ProfileTestProgress {
  readonly context?: Partial<ProfileTestContext>;
  readonly stages?: ProfileTestStage[];
}

export interface ProfileTestResult {
  readonly state: 'passed' | 'failed' | 'unknown';
  readonly outcome?: ProfileTestOutcome;
  readonly error?: string;
  readonly context?: Partial<ProfileTestContext>;
  readonly stages: ProfileTestStage[];
}

/**
 * 由 platform 注入 task-runtime 的实现：在平台命名空间按档位镜像与资源起一个测试 Pod，跑完启动前步骤，
 * 再做一次真实协议轮次或测试命令（RFC-006 §8）。本模块（L3）只依赖端口，不 import L4；执行器自己清理测试 Pod。
 */
export interface ProfileTestExecutor {
  run(input: ProfileTestInput, report: (progress: ProfileTestProgress) => Promise<void>, heartbeat: () => Promise<boolean>): Promise<ProfileTestResult>;
}
