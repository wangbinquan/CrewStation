import type { AgentProfile, OutputContract, ReleaseId, ServiceId } from '@crewstation/contracts';

/** 发布登记时落下的契约快照（G4）：子任务按 UUID 引用，解析到登记当时的定义。 */
export interface ContractRegistration {
  readonly serviceId: ServiceId;
  readonly releaseId: ReleaseId;
  readonly tag: string;
  readonly agentProfiles: AgentProfile[];
  readonly outputContracts: OutputContract[];
  readonly registeredAt: Date;
}

export function resolveProfile(registration: ContractRegistration | undefined, id: string): AgentProfile | undefined {
  return registration?.agentProfiles.find((p) => p.id === id);
}

export function resolveContract(registration: ContractRegistration | undefined, id: string): OutputContract | undefined {
  return registration?.outputContracts.find((c) => c.id === id);
}
