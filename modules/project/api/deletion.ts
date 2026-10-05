import type { AcceptProjectDeletion, Actor, ProjectDeletionBlocker, ProjectDeletionEvidence, ProjectDeletionInventory, ProjectDeletionOperation, ProjectDeletionParticipant, ProjectDeletionPhase, ProjectDeletionPlan, ProjectDeletionTarget, ProjectId } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionOwner } from '@crewstation/contracts';

/** 内部工作器许可；不可由 HTTP 调用方提供，世代和到期时间在持久仓储中核实。 */
export interface ProjectDeletionLease { readonly operationId: string; readonly owner: string; readonly generation: number }
export interface ProjectDeletionApi {
  readonly deletionOwner: ProjectDeletionOwner;
  /** Trusted coordinator identity only; no actor, confirmed content, secrets or new operation. */
  projectDeletionCoordinator(projectId: ProjectId): Promise<{ operationId: string; projectId: ProjectId } | undefined>;
  assertProjectDeletionGrant(context: ProjectDeletionContext): Promise<void>;
  /** Internal participants obtain another owner's original confirmed material from the stored plan, never from a caller-made inventory. */
  projectDeletionParticipantContext(context: ProjectDeletionContext, participant: ProjectDeletionParticipant): Promise<ProjectDeletionContext>;
  deletionScope(projectId: ProjectId): Promise<ProjectDeletionTarget>;
  prepareDeletionPlan(actor: Actor, projectId: ProjectId, inventory: readonly ProjectDeletionInventory[]): Promise<ProjectDeletionPlan>;
  acceptProjectDeletion(actor: Actor, projectId: ProjectId, input: AcceptProjectDeletion, inventory: readonly ProjectDeletionInventory[]): Promise<ProjectDeletionOperation>;
  replayProjectDeletion(actor: Actor, projectId: ProjectId, input: AcceptProjectDeletion): Promise<ProjectDeletionOperation | undefined>;
  readProjectDeletion(actor: Actor, operationId: string): Promise<ProjectDeletionOperation>;
  findProjectDeletion(actor: Actor, projectId: ProjectId): Promise<ProjectDeletionOperation | undefined>;
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
  /** Enqueue is serialized with completion. A busy or terminal operation returns false; recovery retries busy operations. */
  coordinateProjectDeletion(operationId: string, write: (executor: object) => Promise<void>): Promise<boolean>;
  /** Coordinator content removal and final project state commit or roll back together. */
  completeProjectDeletion(lease: ProjectDeletionLease, finalize?: (executor: object, operation: ProjectDeletionOperation) => Promise<void>): Promise<ProjectDeletionOperation>;
  listPendingProjectDeletions(after?: string, limit?: number): Promise<string[]>;
  assertProjectAvailable(projectId: ProjectId): Promise<void>;
  inspectProjectDeletionMetadata(projectId: ProjectId): Promise<ProjectDeletionInventory>;
  purgeProjectDeletionMetadata(lease: ProjectDeletionLease): Promise<ProjectDeletionEvidence>;
}
