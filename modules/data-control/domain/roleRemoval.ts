import type { DataPlaneSnapshot } from './dataPlane';

/** 访问绑定的临时角色的名字形状：新建的是 cs_t_<绑定 ID>，RFC-013 之前的是 <运行角色>_t_<旧 ID 末 8 位>。别的名字一律不删。 */
const TEMPORARY_ROLE = /^cs_(?:[a-z0-9_]+_)?t_[a-z0-9]+$/;

export interface RoleRemovalPlan {
  readonly role: string;
  readonly oid: string;
  readonly database: string;
  readonly reassignTo: string;
}

type RecordLike = { readonly kind: string; readonly desired?: 'present' | 'absent'; readonly spec: { readonly children: readonly { readonly kind: string; readonly name: string }[]; readonly [field: string]: unknown } };
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * 「不要了」的访问绑定（收回、到期、拒绝，设计 §6.6）：它的临时角色还在数据面上就删——删除不需要口令，所以先交给调和器。
 * 只删临时角色形状的名字，不删运行角色；期望里没写所在的库与运行角色（第一步投影的旧记录）就不删，返回 skipped，由 data 自己删过。
 */
export function roleRemovals(record: RecordLike, snapshot: DataPlaneSnapshot): { readonly plans: readonly RoleRemovalPlan[]; readonly skipped: readonly string[] } {
  if (record.kind !== 'data-binding' || record.desired !== 'absent') return { plans: [], skipped: [] };
  const database = record.spec['database'], owner = record.spec['ownerRole'];
  const plans: RoleRemovalPlan[] = [], skipped: string[] = [];
  for (const child of record.spec.children) {
    if (child.kind !== 'PostgresRole') continue;
    const live = snapshot.roles.get(child.name);
    if (!live) continue;
    if (!TEMPORARY_ROLE.test(child.name) || !text(database) || !text(owner) || child.name === owner) { skipped.push(child.name); continue; }
    plans.push({ role: child.name, oid: live.oid, database, reassignTo: owner });
  }
  return { plans, skipped };
}
