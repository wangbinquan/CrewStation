import { jsonHash } from '@crewstation/kernel';
import type { LedgerRecord } from './record';
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


export function maintenanceSnapshot(record: LedgerRecord): MaintenanceEndingSnapshot {
  return { id: record.id, projectId: record.projectId ?? null, owner: record.owner, kind: record.kind,
    generation: record.generation, version: record.version, retainUntil: record.retainUntil?.toISOString() ?? null,
    phaseSince: record.phaseSince.toISOString(), specHash: jsonHash(record.spec) };
}

export function sameMaintenanceSnapshot(record: LedgerRecord, snapshot: MaintenanceEndingSnapshot): boolean {
  return jsonHash(maintenanceSnapshot(record)) === jsonHash(snapshot);
}

/** 字段存在即须由 owner 确认；坏版本不能退回旧的无保护路径。 */
export function selectedDevelopmentRecord(record: LedgerRecord): boolean {
  if (record.owner.module !== 'task-runtime') return false;
  if (Object.hasOwn(record.spec, 'developmentParentEnding')) return true;
  const pod = record.spec['pod'];
  if (pod && typeof pod === 'object' && ['developmentUsageProtection', 'developmentRemovalProtection'].some((key) => Object.hasOwn(pod, key))) return true;
  const rebuild = record.spec['rebuild'];
  return !!rebuild && typeof rebuild === 'object' && Object.hasOwn(rebuild, 'developmentParentSelection');
}
