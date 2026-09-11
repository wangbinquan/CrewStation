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
}

/** 每一步都必须幂等：开通任务可能因任一步失败而整体重跑。 */
export interface ProvisioningSteps {
  loadProject(projectId: ProjectId): Promise<ProjectFacts | undefined>;
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
