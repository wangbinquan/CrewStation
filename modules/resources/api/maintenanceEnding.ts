import type { ProjectId, ResourceKind, ResourceOwner } from '@crewstation/contracts';

/** 中性资源身份；不携带 Task 数字、凭据或临时删除许可。 */
export interface MaintenanceEndingSnapshot {
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

export type MaintenanceStep = 'retention' | 'compaction';
export type MaintenanceEndingDecision =
  | { readonly status: 'unselected' }
  | { readonly status: 'waiting'; readonly reason: string }
  | { readonly status: 'permitted'; readonly snapshot: MaintenanceEndingSnapshot };
export type MaintenanceEndingHandler = (step: MaintenanceStep, snapshot: MaintenanceEndingSnapshot) => Promise<MaintenanceEndingDecision>;
