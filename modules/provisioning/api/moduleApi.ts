import type { ProjectId } from '@crewstation/contracts';

/** 一轮命名空间重下发的结果（RFC-018）：成功与失败的项目数，用于日志与用例断言。 */
export interface ReapplyOutcome {
  readonly applied: number;
  readonly failed: number;
}

export interface ProvisioningModuleApi {
  readonly name: 'provisioning';
  /** 同步执行一次开通链（CLI 与测试用）；正常路径由 project.created 事件入队。 */
  provisionProject(projectId: ProjectId): Promise<'active' | 'failed' | 'skipped'>;
  /** 重新开通失败的项目。 */
  retry(projectId: ProjectId): Promise<void>;
  /** 对全部未归档项目重跑 `ensureNamespace`（RFC-018）；控制面启动时调用一次。 */
  reapplyNamespaces(): Promise<ReapplyOutcome>;
}
