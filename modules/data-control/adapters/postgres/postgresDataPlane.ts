import postgres from 'postgres';
import type { DataPlaneObject } from '../../domain/dataPlane';
import type { DataPlaneReader } from '../../ports/dataPlane';

/** 平台建的库与角色都以 `cs_` 开头（生产库 cs_<slug>、开发库 cs_<slug>_dev、临时角色 cs_t_…）；平台自己的库与角色不在内。 */
const PREFIX = 'cs\\_%';

/**
 * 数据面快照：用与 data 供给同一个管理连接（只读查询 pg_database、pg_roles）。连接用 postgres.js（RFC-023），服务端提示不打印。
 */
export function postgresDataPlane(adminUrl: string, clock: { now(): Date } = { now: () => new Date() }): DataPlaneReader {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  return {
    snapshot: async () => {
      const databases = await admin<{ oid: string; name: string }[]>`SELECT oid::text AS oid, datname AS name FROM pg_database WHERE datname LIKE ${PREFIX}`;
      const roles = await admin<{ oid: string; name: string; valid_until: Date | null }[]>`SELECT oid::text AS oid, rolname AS name, rolvaliduntil AS valid_until FROM pg_roles WHERE rolname LIKE ${PREFIX}`;
      const table = (rows: readonly DataPlaneObject[]) => new Map(rows.map((row) => [row.name, row]));
      return {
        databases: table(databases.map((row) => ({ name: row.name, oid: row.oid }))),
        // VALID UNTIL 'infinity' 读回来不是有效时间，按没有到期处理。
        roles: table(roles.map((row) => ({ name: row.name, oid: row.oid, ...(row.valid_until && Number.isFinite(row.valid_until.getTime()) ? { validUntil: row.valid_until.toISOString() } : {}) }))),
        observedAt: clock.now().toISOString(),
      };
    },
    close: async () => { await admin.end(); },
  };
}
