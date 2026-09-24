import type { DataPlaneSnapshot } from './dataPlane';

/** 期望里标明「由 data-control 建」的写法（I28）：data 写，旧库（data 自己建的）没有。 */
export const PROVISIONED_BY_DATA_CONTROL = 'data-control';

type Child = { readonly kind: string; readonly name: string };

/**
 * 要建的库（I28）：生产库或开发库的记录、期望在、标明由 data-control 建，且快照里库或同名运行角色还不在；其余返回 undefined——
 * 旧库仍归 data 建，已经都在的不再动（口令也不换）。
 */
export function databaseToProvision(record: { readonly kind: string; readonly desired?: 'present' | 'absent'; readonly spec: { readonly children: readonly Child[]; readonly [field: string]: unknown } }, snapshot: DataPlaneSnapshot): { readonly database: string; readonly role: string } | undefined {
  if (record.kind !== 'database' || record.desired === 'absent' || record.spec['provision'] !== PROVISIONED_BY_DATA_CONTROL) return undefined;
  const database = record.spec.children.find((child) => child.kind === 'PostgresDatabase')?.name, role = record.spec.children.find((child) => child.kind === 'PostgresRole')?.name;
  if (!database || !role) return undefined;
  return snapshot.databases.has(database) && snapshot.roles.has(role) ? undefined : { database, role };
}

/**
 * 要建的临时角色（I28 第二步）：访问绑定的记录、期望在、标明由 data-control 建，期望里有所在的生产库、运行角色与到期时间，
 * 且快照里角色还不在；其余返回 undefined。诊断只读的只授读，生产变更的继承运行角色。
 */
export function temporaryRoleToProvision(record: { readonly kind: string; readonly desired?: 'present' | 'absent'; readonly spec: { readonly children: readonly Child[]; readonly [field: string]: unknown } }, snapshot: DataPlaneSnapshot): { readonly role: string; readonly database: string; readonly ownerRole: string; readonly readOnly: boolean; readonly validUntil: string } | undefined {
  if (record.kind !== 'data-binding' || record.desired === 'absent' || record.spec['provision'] !== PROVISIONED_BY_DATA_CONTROL) return undefined;
  const role = record.spec.children.find((child) => child.kind === 'PostgresRole')?.name;
  const database = record.spec['database'], ownerRole = record.spec['ownerRole'], expiresAt = record.spec['expiresAt'], mode = record.spec['mode'];
  if (!role || typeof database !== 'string' || typeof ownerRole !== 'string' || typeof expiresAt !== 'string' || (mode !== 'diagnostic-readonly' && mode !== 'production-change')) return undefined;
  return snapshot.roles.has(role) ? undefined : { role, database, ownerRole, readOnly: mode === 'diagnostic-readonly', validUntil: expiresAt };
}
