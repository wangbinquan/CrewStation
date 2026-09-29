import type { RunnerUsageMeasurement, RunnerUsageSourceIdentity, RunnerUsageSourcePage, Actor, BusinessTaskV3Dto, ExecutionObservationIdentity, ProjectId, ResourceChild, ResourceCondition, ServiceId, TaskId } from '@crewstation/contracts';

/** Only the owner metadata needed to connect observability at composition time. */
export interface ObservationTasks {
  getTask(caller: { identity: string; token?: string }, taskId: TaskId): Promise<Pick<BusinessTaskV3Dto, 'id' | 'serviceId'>>;
}
export interface ObservationProjects { resolveServiceById(serviceId: ServiceId): Promise<{ projectId: ProjectId } | undefined> }
export interface ObservationProfiles {
  listProfiles(actor: Actor): Promise<{ items: Array<{ id: string; name: string; revision: number; protocol: 'opencode' | 'claude-code' | 'terminal'; model?: string }> }>;
}
export interface ObservationAdmissionInput {
  identity: ExecutionObservationIdentity;
  profile: { id: string; revision: number; protocol: 'opencode' | 'claude-code' | 'terminal' } | null;
}
export interface ObservationPriceOwner { acceptExecutionPrice(input: ObservationAdmissionInput): Promise<unknown> }
export interface ObservationResourceLedger {
  list(filter: { projectId: ProjectId; kind: 'service-slot'; includeStopped: true }): Promise<ReadonlyArray<{
    display: Readonly<Record<string, string>>; children: readonly ResourceChild[]; conditions: readonly ResourceCondition[]; phaseSince: Date;
  }>>;
}

export interface ObservationUsageOwner {
  resolveUsageSource(input: RunnerUsageSourceIdentity): Promise<ExecutionObservationIdentity | undefined>;
}
export interface ObservationUsageJournal {
  nextBusinessUsageSource(): Promise<RunnerUsageSourcePage | undefined>;
  readBusinessUsageMeasurement(source: RunnerUsageSourceIdentity, recordId: string, revision: number): Promise<RunnerUsageMeasurement | undefined>;
  acknowledgeBusinessUsageSource(taskId: TaskId, executionId: string, through: number): Promise<void>;
}

export interface ObservationNameSources {
  projects: { listClusterProjects(): Promise<Array<{ projectId: string; name: string }>> };
  profiles: { listDisplayNames(): Promise<Array<{ id: string; name: string }>> };
}
