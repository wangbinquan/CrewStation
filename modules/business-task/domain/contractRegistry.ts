import type { BusinessReleaseMaterials } from '@crewstation/contracts';
import type { AgentProfile, OutputContract, ReleaseId, ServiceId, TasksSpec } from '@crewstation/contracts';

/** 发布登记时落下的契约快照（G4）：子任务按 UUID 引用，解析到登记当时的定义。 */
export interface ContractRegistration {
  readonly releaseMaterials?: BusinessReleaseMaterials;
  readonly serviceId: ServiceId;
  readonly releaseId: ReleaseId;
  readonly tag: string;
  readonly agentProfiles: AgentProfile[];
  readonly outputContracts: OutputContract[];
  /** RFC-027：旧登记没有完整任务声明，不能用于创建 v3 任务。 */
  readonly tasksSpec?: TasksSpec;
  readonly registeredAt: Date;
}

export function resolveProfile(registration: ContractRegistration | undefined, id: string): AgentProfile | undefined {
  return registration?.agentProfiles.find((p) => p.id === id);
}

export function resolveContract(registration: ContractRegistration | undefined, id: string): OutputContract | undefined {
  return registration?.outputContracts.find((c) => c.id === id);
}
