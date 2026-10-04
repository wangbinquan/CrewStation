import type { ProjectDeletionContext, ProjectDeletionParticipant, TaskId, WorkloadConsumer, WorkloadStartPermit, WorkloadStopProof } from '@crewstation/contracts';

export interface RuntimeStoppedEnvironment {
  readonly id: TaskId;
  readonly namespace: string;
  readonly podName: string;
  readonly podUid?: string;
  readonly kind?: string;
  readonly native?: { readonly podUid?: string; readonly parentTaskId?: TaskId; readonly pvcUid?: string };
  readonly render?: { readonly workloadConsumerId?: string; readonly start: number };
  readonly businessWorkspace?: { readonly volumeUid: string };
}
export interface RuntimeStopProject {
  assertProjectDeletionGrant(context: ProjectDeletionContext): Promise<void>;
  projectDeletionParticipantContext(context: ProjectDeletionContext, participant: ProjectDeletionParticipant): Promise<ProjectDeletionContext>;
}
export interface RuntimeStopReceipts {
  get(context: ProjectDeletionContext, key: string, uid: string): Promise<{ readonly key: string; readonly uid: string; readonly nodeUid: string | null; readonly digest: string; readonly observedAt: string } | undefined>;
}
/** Read the original durable writer and its observer proof; this port cannot close or register a writer. */
export interface RuntimeStopHistory {
  get(id: string): Promise<{ readonly consumer: WorkloadConsumer; readonly admissionClosed: boolean; readonly startPermit: WorkloadStartPermit | null; readonly stopProof: WorkloadStopProof | null } | undefined>;
}
