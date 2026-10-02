import type { ProjectId, ResourceKind, ResourceOwner } from '@crewstation/contracts';

/** Internal composition port; owner modules are bound only in the composition root. */
export interface TaskMaintenanceSnapshot {
  readonly id: string;
  readonly projectId: ProjectId | null;
  readonly owner: ResourceOwner;
  readonly kind: ResourceKind;
  readonly generation: number;
  readonly version: number;
  readonly retainUntil: string | null;
  readonly phaseSince: string;
  readonly specHash: string;
}
export type TaskMaintenanceDecision =
  | { readonly status: 'unselected' }
  | { readonly status: 'waiting'; readonly reason: string }
  | { readonly status: 'permitted'; readonly snapshot: TaskMaintenanceSnapshot };
export type TaskMaintenanceHandler = (step: 'retention' | 'compaction', snapshot: TaskMaintenanceSnapshot) => Promise<TaskMaintenanceDecision>;
export interface TaskMaintenanceRegistry {
  registerMaintenanceEndingHandler(owner: string, handler: TaskMaintenanceHandler): void;
}
export interface TaskMaintenanceRuntime {
  inspectResourceEnding?: TaskMaintenanceHandler;
}
