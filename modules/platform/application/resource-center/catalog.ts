import type { ProjectId, ResourceQuotaMetric, ResourceTargetDescription } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import type { ResourceCatalogAdapter, ResourceReceipt } from '../../ports/resourceCatalogs';

export function catalogAdapter(type: ResourceCatalogAdapter['resourceType'], list: ResourceCatalogAdapter['list'], apply: ResourceCatalogAdapter['apply'], recover?: ResourceCatalogAdapter['recover'], observe?: ResourceCatalogAdapter['observe']): ResourceCatalogAdapter {
  return { resourceType: type, list, read: async (id, target) => {
    const view = (await list(id)).find((v) => v.target.resourceId === target.resourceId && v.target.action === target.action);
    if (!view) throw notFound('项目资源目标'); return view;
  }, apply, ...(recover ? { recover } : {}), ...(observe ? { observe } : {}) };
}
export const actions = (view: ResourceTargetDescription, allowRevoke = true) => [view, ...(allowRevoke && view.owned && view.target.action === 'grant' ? [{ ...view, target: { ...view.target, action: 'revoke' as const }, available: true, impact: [...view.impact, '撤销只影响后续选择；已运行实例与固定版本保持原状态'] }] : [])];
export const quotaMetric = (scopeId: string, key: string, label: string, unit: string, limit: number | null, used: number | null = null, reserved: number | null = null): ResourceQuotaMetric => ({ scopeId, key, label, unit, limit, used, reserved, requestedLimit: null, limitKind: limit === null ? 'unknown' : 'value', observedAt: null });
export const resourceCommand = (c: Parameters<ResourceCatalogAdapter['apply']>[0]) => ({ operationId: c.operationId, target: c.target, expectedRevision: c.expectedRevision, values: c.values });
export async function pagedCatalog<T extends { id: string }>(load: (page: { limit: number; before?: string }) => Promise<T[]>): Promise<T[]> {
  const all: T[] = []; let before: string | undefined;
  for (let page = 0; page < 20; page++) { const rows = await load({ limit: 100, ...(before ? { before } : {}) }); all.push(...rows); if (rows.length < 100) return all; const next = rows.at(-1)!.id; if (before === next) throw precondition('目录游标未前进'); before = next; }
  throw precondition('目录超过首屏安全读取上限，请从目录筛选后查看');
}
export function confirming(recover: (id: ProjectId, operationId: string) => Promise<ResourceReceipt | undefined>, project: (id: ProjectId) => Promise<void>) {
  return async (id: ProjectId, operationId: string) => { const receipt = await recover(id, operationId); if (receipt && !receipt.applied) await project(id); return receipt; };
}
