import type { AgentProfile, OutputContract, ReleaseId, ServiceId } from '@crewstation/contracts';

/** 发布登记时落下的契约快照（G4）：子任务按名字引用，解析到登记当时的定义。 */
export interface ContractRegistration {
  readonly serviceId: ServiceId;
  readonly releaseId: ReleaseId;
  readonly tag: string;
  readonly agentProfiles: AgentProfile[];
  readonly outputContracts: OutputContract[];
  readonly registeredAt: Date;
}

export function resolveProfile(registration: ContractRegistration | undefined, name: string): AgentProfile | undefined {
  return registration?.agentProfiles.find((p) => p.name === name);
}

export function resolveContract(registration: ContractRegistration | undefined, name: string): OutputContract | undefined {
  return registration?.outputContracts.find((c) => c.name === name);
}
