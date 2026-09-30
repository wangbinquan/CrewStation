import type { AcceptProjectDeletion, Actor, ProjectDeletionBlocker, ProjectDeletionEvidence, ProjectDeletionInventory, ProjectDeletionOperation, ProjectDeletionParticipant, ProjectDeletionPhase, ProjectDeletionPlan, ProjectDeletionTarget, ProjectId } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionOwner } from '@crewstation/contracts';

/** 内部工作器许可；不可由 HTTP 调用方提供，世代和到期时间在持久仓储中核实。 */
export interface ProjectDeletionLease { readonly operationId: string; readonly owner: string; readonly generation: number }
export interface ProjectDeletionApi {
  readonly deletionOwner: ProjectDeletionOwner;
  assertProjectDeletionGrant(context: ProjectDeletionContext): Promise<void>;
  deletionScope(projectId: ProjectId): Promise<ProjectDeletionTarget>;
  prepareDeletionPlan(actor: Actor, projectId: ProjectId, inventory: readonly ProjectDeletionInventory[]): Promise<ProjectDeletionPlan>;
  acceptProjectDeletion(actor: Actor, projectId: ProjectId, input: AcceptProjectDeletion, inventory: readonly ProjectDeletionInventory[]): Promise<ProjectDeletionOperation>;
  replayProjectDeletion(actor: Actor, projectId: ProjectId, input: AcceptProjectDeletion): Promise<ProjectDeletionOperation | undefined>;
  readProjectDeletion(actor: Actor, operationId: string): Promise<ProjectDeletionOperation>;
  retryProjectDeletion(actor: Actor, operationId: string): Promise<ProjectDeletionOperation>;
  prepareProjectDeletionReconfirmation(actor: Actor, operationId: string, inventory: readonly ProjectDeletionInventory[]): Promise<ProjectDeletionPlan>;
  replayProjectDeletionReconfirmation(actor: Actor, operationId: string, input: AcceptProjectDeletion): Promise<ProjectDeletionOperation | undefined>;
  reconfirmProjectDeletion(actor: Actor, operationId: string, input: AcceptProjectDeletion, inventory: readonly ProjectDeletionInventory[]): Promise<ProjectDeletionOperation>;
  /** 已完成操作没有计划原文；只有成功认领的工作器才拿到清理身份。 */
  claimProjectDeletion(operationId: string, owner: string, leaseSeconds?: number): Promise<{ lease: ProjectDeletionLease; operation: ProjectDeletionOperation; plan: ProjectDeletionPlan } | undefined>;
  renewProjectDeletion(lease: ProjectDeletionLease, leaseSeconds?: number): Promise<void>;
  deferProjectDeletion(lease: ProjectDeletionLease, participant: ProjectDeletionParticipant, reason: string): Promise<void>;
  recordProjectDeletionReceipt(lease: ProjectDeletionLease, participant: ProjectDeletionParticipant, phase: ProjectDeletionPhase, evidence: ProjectDeletionEvidence): Promise<ProjectDeletionOperation>;
  blockProjectDeletion(lease: ProjectDeletionLease, blockers: readonly ProjectDeletionBlocker[]): Promise<ProjectDeletionOperation>;
  completeProjectDeletion(lease: ProjectDeletionLease): Promise<ProjectDeletionOperation>;
  listPendingProjectDeletions(after?: string, limit?: number): Promise<string[]>;
  assertProjectAvailable(projectId: ProjectId): Promise<void>;
  inspectProjectDeletionMetadata(projectId: ProjectId): Promise<ProjectDeletionInventory>;
  purgeProjectDeletionMetadata(lease: ProjectDeletionLease): Promise<ProjectDeletionEvidence>;
}
