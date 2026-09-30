import type { ProjectDeletionOperation, ProjectDeletionPlan, UserId } from '@crewstation/contracts';

export interface DeletionPlanRecord { readonly plan: ProjectDeletionPlan; readonly requestedBy: UserId; readonly createdAt: Date }
export interface DeletionOperationRecord {
  readonly operation: ProjectDeletionOperation;
  readonly planId: string;
  readonly requestKey: string;
  readonly requestedBy: UserId;
  readonly generation: number;
  readonly leaseOwner?: string;
  readonly leaseUntil?: Date;
}
export interface DeletionLease { readonly operationId: string; readonly owner: string; readonly generation: number }
