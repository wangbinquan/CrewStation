import postgres from 'postgres';
import type { DataPlaneObject } from '../../domain/dataPlane';
import type { DataPlaneReader, DataPlaneWriter } from '../../ports/dataPlane';

/** 平台建的库与角色都以 `cs_` 开头（生产库 cs_<slug>、开发库 cs_<slug>_dev、临时角色 cs_t_…）；平台自己的库与角色不在内。 */
const PREFIX = 'cs\\_%';

const ident = (name: string): string => {
  if (!/^cs_[a-z0-9_]{1,60}$/.test(name)) throw new Error(`非法的数据面标识符：${name}`);
  return `"${name}"`;
};

/**
 * 数据面：用与 data 供给同一个管理连接。快照是只读查询（pg_database、pg_roles）；写目前只有删访问绑定的临时角色。
 * 连接用 postgres.js（RFC-023），服务端提示不打印。
 */
export function postgresDataPlane(adminUrl: string, clock: { now(): Date } = { now: () => new Date() }): DataPlaneReader & DataPlaneWriter {
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
    // 与 data 供给适配器的删角色同一套步骤：断开连接 → 在所在库里转交并撤销它拥有的对象 → 删它在全局的授权 → 删角色。
    dropRole: async ({ role, oid, database, reassignTo }) => {
      const quoted = ident(role);
      const current = await admin<{ oid: string }[]>`SELECT oid::text AS oid FROM pg_roles WHERE rolname = ${role}`;
      if (!current[0]) return 'absent';
      if (oid && current[0].oid !== oid) return 'replaced';
      await admin`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = ${role}`;
      if (database) {
        const target = new URL(adminUrl);
        target.pathname = `/${database}`;
        const inDb = postgres(target.toString(), { max: 1, onnotice: () => undefined });
        try {
          if (reassignTo) await inDb.unsafe(`REASSIGN OWNED BY ${quoted} TO ${ident(reassignTo)}`);
          await inDb.unsafe(`DROP OWNED BY ${quoted}`);
        } finally {
          await inDb.end();
        }
      }
      await admin.unsafe(`DROP OWNED BY ${quoted}`);
      await admin.unsafe(`DROP ROLE ${quoted}`);
      return 'dropped';
    },
    close: async () => { await admin.end(); },
  };
}
