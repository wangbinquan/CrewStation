import type { AcceptProjectDeletion, Actor, ProjectDeletionBlocker, ProjectDeletionContext, ProjectDeletionEvidence, ProjectDeletionInventory, ProjectDeletionOperation, ProjectDeletionOwner, ProjectDeletionParticipant, ProjectDeletionPhase, ProjectDeletionPlan, ProjectDeletionTarget, ProjectId } from '@crewstation/contracts';

/** 只观察已进入终结的原 Pod；不发起删除，也不产生参与者的 stop 完成回执。 */
export interface ProjectDeletionStopOwner extends ProjectDeletionOwner {
  observeTerminating?(context: ProjectDeletionContext): Promise<void>;
}

export interface DeletionLease { readonly operationId: string; readonly owner: string; readonly generation: number }
/** 生命周期事实经 project 公开能力反转，不在 provisioning 操作 project schema。 */
export interface ProjectDeletionIntents {
  scope(id: ProjectId): Promise<ProjectDeletionTarget>;
  prepare(actor: Actor, id: ProjectId, inventory: readonly ProjectDeletionInventory[]): Promise<ProjectDeletionPlan>;
  accept(actor: Actor, id: ProjectId, input: AcceptProjectDeletion, inventory: readonly ProjectDeletionInventory[]): Promise<ProjectDeletionOperation>;
  replay(actor: Actor, id: ProjectId, input: AcceptProjectDeletion): Promise<ProjectDeletionOperation | undefined>;
  read(actor: Actor, id: string): Promise<ProjectDeletionOperation>;
  find(actor: Actor, id: ProjectId): Promise<ProjectDeletionOperation | undefined>;
  retry(actor: Actor, id: string): Promise<ProjectDeletionOperation>;
  prepareReconfirmation(actor: Actor, id: string, inventory: readonly ProjectDeletionInventory[]): Promise<ProjectDeletionPlan>;
  replayReconfirmation(actor: Actor, id: string, input: AcceptProjectDeletion): Promise<ProjectDeletionOperation | undefined>;
  reconfirm(actor: Actor, id: string, input: AcceptProjectDeletion, inventory: readonly ProjectDeletionInventory[]): Promise<ProjectDeletionOperation>;
  claim(id: string, owner: string, seconds: number): Promise<{ lease: DeletionLease; operation: ProjectDeletionOperation; plan: ProjectDeletionPlan } | undefined>;
  renew(lease: DeletionLease, seconds: number): Promise<void>;
  defer(lease: DeletionLease, participant: ProjectDeletionParticipant, reason: string): Promise<void>;
  receipt(lease: DeletionLease, participant: ProjectDeletionParticipant, phase: ProjectDeletionPhase, evidence: ProjectDeletionEvidence): Promise<ProjectDeletionOperation>;
  block(lease: DeletionLease, blockers: readonly ProjectDeletionBlocker[]): Promise<ProjectDeletionOperation>;
  complete(lease: DeletionLease): Promise<ProjectDeletionOperation>;
  coordinate(id: string, write: (executor: object) => Promise<void>): Promise<boolean>;
  pending(after?: string, limit?: number): Promise<string[]>;
}
