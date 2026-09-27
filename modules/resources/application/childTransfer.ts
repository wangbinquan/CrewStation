import { conflict, forbidden, notFound, validation } from '@crewstation/kernel';
import type { ResourceDeclaration } from '../api/types';
import type { LedgerRecord } from '../domain/record';
import { childKey } from '../domain/record';
import type { LedgerScope } from '../ports/repositories';
import { commitRecord } from './commit';

/** 同模块的工作区预览拆成 route：认领与现有观测一起移交，不删除物理对象。 */
export async function splitChildrenIn(scope: LedgerScope, module: string, sourceId: string, input: ResourceDeclaration, now: Date, declare: () => Promise<LedgerRecord>): Promise<LedgerRecord> {
  const source = await scope.records.get(sourceId, { forUpdate: true });
  if (!source) throw notFound('资源', sourceId);
  if (source.owner.module !== module) throw forbidden('只能移交本模块拥有的资源');
  if (!['dev-workspace', 'business-workspace'].includes(source.kind) || input.kind !== 'route' || input.parentId !== source.id || input.projectId !== source.projectId
    || !input.spec.children.length || input.spec.children.some((child) => child.kind !== 'IngressRoute')) throw validation('只能把同项目工作区的预览入口移交给它的路由记录');
  const target = await scope.records.getByOwner({ module, ref: input.ref }, input.kind);
  const claims = await scope.records.claimed(input.spec.children);
  if (claims.some((entry) => entry.resourceId !== source.id && entry.resourceId !== target?.id)) throw conflict('预览入口已属于另一条资源');
  const moving = new Set(claims.filter((entry) => entry.resourceId === source.id).map((entry) => childKey(entry.child)));
  if (!moving.size) return declare();
  // 与旧工作区调和和路由仲裁互斥。租约的写与释放都在调用方事务内，其他获取者直到提交后才继续。
  const holder = `child-transfer/${crypto.randomUUID()}`, acquired: string[] = [];
  try {
    for (const lease of [source.id, 'route-arbitration']) {
      if (!await scope.leases.acquire(lease, holder, 30_000)) throw conflict('预览入口正在调和，稍后重试移交');
      acquired.push(lease);
    }
    const children = source.children.filter((child) => moving.has(childKey(child)));
    await commitRecord(scope, source, { ...source, generation: source.generation + 1,
      spec: { ...source.spec, children: source.spec.children.filter((child) => !moving.has(childKey(child))) },
      children: source.children.filter((child) => !moving.has(childKey(child))) }, now);
    const declared = await declare();
    return commitRecord(scope, declared, { ...declared, children: [...declared.children.filter((child) => !moving.has(childKey(child))), ...children] }, now);
  } finally {
    for (const lease of acquired.reverse()) await scope.leases.release(lease, holder);
  }
}
