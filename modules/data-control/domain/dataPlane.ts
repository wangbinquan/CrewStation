import type { ResourceChild } from '@crewstation/contracts';

/** 数据面上观测到的一个对象（平台数据库集群）：名字与 OID——OID 当作 UID，同名删了重建的是另一个对象。 */
export interface DataPlaneObject {
  readonly name: string;
  readonly oid: string;
  /** 角色的 VALID UNTIL（临时角色由数据库自己执行到期）。 */
  readonly validUntil?: string;
}

/** 一次数据面快照：库与角色各一张按名字的表。 */
export interface DataPlaneSnapshot {
  readonly databases: ReadonlyMap<string, DataPlaneObject>;
  readonly roles: ReadonlyMap<string, DataPlaneObject>;
  readonly observedAt: string;
}

/** data-control 观测的记录种类（RFC-025 第四期）：生产库、开发库与数据访问绑定。 */
export const DATA_KINDS: ReadonlySet<string> = new Set(['database', 'data-binding']);

type Child = { readonly kind: string; readonly namespace?: string; readonly name: string };
const key = (child: Child) => `${child.kind}/${child.namespace ?? ''}/${child.name}`;

function tableOf(snapshot: DataPlaneSnapshot, kind: string): ReadonlyMap<string, DataPlaneObject> | undefined {
  if (kind === 'PostgresDatabase') return snapshot.databases;
  return kind === 'PostgresRole' ? snapshot.roles : undefined;
}

/** 在的对象的观测：OID 当 UID；角色过了 VALID UNTIL 记 Expired（还在，却已登录不了）。 */
function presentChild(kind: string, object: DataPlaneObject, snapshot: DataPlaneSnapshot): ResourceChild {
  const expired = object.validUntil !== undefined && Date.parse(object.validUntil) <= Date.parse(snapshot.observedAt);
  return { kind, name: object.name, uid: object.oid, phase: expired ? 'Expired' : 'Present', ready: !expired, observedAt: snapshot.observedAt };
}

/**
 * 按记录核对数据面（设计 §6.6）：期望里的与台账记着的子对象（期望里已经没有、却还在的也在内）逐个在快照里找——在的补一条观测，
 * 不在而台账记着在的补一条消失；从没观测到、也不在的不报。不认识的子对象种类不管。
 */
export function dataObservations(record: { readonly spec: { readonly children: readonly Child[] }; readonly children: readonly ResourceChild[] }, snapshot: DataPlaneSnapshot): { readonly child: ResourceChild; readonly gone: boolean }[] {
  const expected = new Set(record.spec.children.map(key));
  const targets = [...record.spec.children, ...record.children.filter((child) => !expected.has(key(child)))];
  const out: { child: ResourceChild; gone: boolean }[] = [];
  for (const target of targets) {
    const table = tableOf(snapshot, target.kind);
    if (!table) continue;
    const object = table.get(target.name);
    if (object) {
      out.push({ child: presentChild(target.kind, object, snapshot), gone: false });
      continue;
    }
    const recorded = record.children.find((child) => key(child) === key(target));
    if (recorded && recorded.phase !== 'absent') out.push({ child: { kind: target.kind, name: target.name, ...(recorded.uid ? { uid: recorded.uid } : {}), phase: 'absent', ready: false }, gone: true });
  }
  return out;
}
