import type { ServicePlanDto, ServicePlanWrite, TaskProfileDto, TaskProfileWrite } from '@crewstation/contracts';

export type ResourceCatalogKind = 'service' | 'task';
export type ResourceCatalogEntry = ServicePlanDto | TaskProfileDto;
export type ResourceCatalogInput = (ServicePlanWrite | TaskProfileWrite) & { id?: string };
export interface ResourceCatalogDraft { id: string; name: string; cpu: string; memory: string; maxReplicas: string; storage: string; description: string }
export type ResourceCatalogField = keyof ResourceCatalogDraft;
export type ResourceCatalogErrors = Partial<Record<ResourceCatalogField, string>>;

export function resourceCatalogDraft(entry?: ResourceCatalogInput): ResourceCatalogDraft {
  return { id: entry?.id ?? '', name: entry?.name ?? '', cpu: entry?.cpu ?? '', memory: entry?.memory ?? '', description: entry?.description ?? '',
    maxReplicas: entry && 'maxReplicas' in entry ? String(entry.maxReplicas) : '1', storage: entry && 'storage' in entry ? entry.storage : '' };
}

/** 保持现有数量字符串契约，不擅自裁掉合法的 Kubernetes 数量写法。 */
export function resourceCatalogErrors(kind: ResourceCatalogKind, draft: ResourceCatalogDraft): ResourceCatalogErrors {
  const errors: ResourceCatalogErrors = {};
  if (!draft.name.trim() || draft.name.trim().length > 80) errors.name = 'nameError';
  if (!draft.cpu.trim()) errors.cpu = 'cpuRequired';
  if (!draft.memory.trim()) errors.memory = 'memoryRequired';
  if (kind === 'task' && !draft.storage.trim()) errors.storage = 'storageRequired';
  if (kind === 'service' && (!/^\d+$/.test(draft.maxReplicas.trim()) || !Number.isSafeInteger(Number(draft.maxReplicas)) || Number(draft.maxReplicas) < 1)) errors.maxReplicas = 'replicasError';
  return errors;
}

export function resourceCatalogInput(kind: ResourceCatalogKind, draft: ResourceCatalogDraft): ResourceCatalogInput {
  const common = { ...(draft.id ? { id: draft.id } : {}), name: draft.name.trim(), cpu: draft.cpu.trim(), memory: draft.memory.trim(), description: draft.description };
  return kind === 'service' ? { ...common, maxReplicas: Number(draft.maxReplicas) } : { ...common, storage: draft.storage.trim() };
}

export function sameResourceCatalogEntry(left: ResourceCatalogInput | undefined, right: ResourceCatalogInput | undefined): boolean {
  if (!left || !right) return left === right;
  if (left.id && right.id && left.id !== right.id) return false;
  return JSON.stringify({ ...resourceCatalogDraft(left), id: '' }) === JSON.stringify({ ...resourceCatalogDraft(right), id: '' });
}
