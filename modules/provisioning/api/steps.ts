import type { ProjectId, ProjectState, ServiceId } from '@crewstation/contracts';

export interface ProjectFacts {
  projectId: ProjectId;
  /** 载入时的项目状态：失败重跑要先回到 provisioning，否则失败原因写不回去。 */
  state: ProjectState;
  serviceId: ServiceId;
  slug: string;
  name: string;
  namespace: string;
  kind: 'DigitalWorker' | 'APIProxy' | 'EventProducer';
  template: string;
  /** 仅生成首次仓库 Manifest；旧项目未记录时保留模板原值。 */
  initialPlan?: string;
}

/** 每一步都必须幂等：开通任务可能因任一步失败而整体重跑。 */
export interface ProvisioningSteps {
  loadProject(projectId: ProjectId): Promise<ProjectFacts | undefined>;
  /**
   * 全部未归档项目的开通事实，供启动重下发遍历（RFC-018）：把每个项目命名空间的期望再写一遍（RFC-025 第四期起是台账记录，
   * 台账接上之前建的项目由它第一次写进台账；项目该有的网络策略变了也由它改期望）。
   */
  listProjects(): Promise<ProjectFacts[]>;
  /**
   * 命名空间、额度与网络策略。模块自己实现（RFC-025 第四期）：开通链里写台账期望、等记录运行中再走下一步；启动重下发只写期望。
   * 组合根不再提供它（见 ExternalSteps）。
   */
  ensureNamespace(facts: ProjectFacts): Promise<void>;
  ensureRepository(facts: ProjectFacts): Promise<void>;
  ensureData(facts: ProjectFacts): Promise<void>;
  reconcileRoutes(facts: ProjectFacts): Promise<void>;
  /** 首个标签发布到 preview 槽（Plan T1.12）；已有发布时跳过。 */
  ensureFirstRelease(facts: ProjectFacts): Promise<void>;
  setProjectState(projectId: ProjectId, state: ProjectState, message?: string): Promise<void>;
}

/** 组合根提供的步骤：命名空间那一步由模块自己写台账期望。 */
export type ExternalSteps = Omit<ProvisioningSteps, 'ensureNamespace'>;

export interface ProvisioningJobs {
  enqueue(projectId: ProjectId): Promise<void>;
}
