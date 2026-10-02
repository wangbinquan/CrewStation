import type { ProjectId, ResourceKind, ResourceOwner } from '@crewstation/contracts';

/** Internal owner composition contract; no credentials, digital totals or physical permit. */
export interface ResourceEndingSnapshot {
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
export type ResourceEndingStep = 'retention' | 'compaction';
export type ResourceEndingDecision =
  | { readonly status: 'unselected' }
  | { readonly status: 'waiting'; readonly reason: string }
  | { readonly status: 'permitted'; readonly snapshot: ResourceEndingSnapshot };
