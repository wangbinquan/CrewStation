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
   * 全部未归档项目的开通事实，供启动重下发遍历（RFC-018）。
   * 命名空间对象的形状会随版本变化，而开通链只在建项目时跑过一次；没有这一步，存量命名空间永远停在旧形状。
   */
  listProjects(): Promise<ProjectFacts[]>;
  ensureNamespace(facts: ProjectFacts): Promise<void>;
  ensureRepository(facts: ProjectFacts): Promise<void>;
  ensureData(facts: ProjectFacts): Promise<void>;
  reconcileRoutes(facts: ProjectFacts): Promise<void>;
  /** 首个标签发布到 preview 槽（Plan T1.12）；已有发布时跳过。 */
  ensureFirstRelease(facts: ProjectFacts): Promise<void>;
  setProjectState(projectId: ProjectId, state: ProjectState, message?: string): Promise<void>;
}

export interface ProvisioningJobs {
  enqueue(projectId: ProjectId): Promise<void>;
}
