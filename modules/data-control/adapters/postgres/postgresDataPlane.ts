import postgres from 'postgres';
import { conflict, precondition } from '@crewstation/kernel';
import type { DataPlaneObject } from '../../domain/dataPlane';
import type { DataPlaneReader, DataPlaneWriter } from '../../ports/dataPlane';
import type { NativeDdlConnection, NativePostgresOrigin, NativePostgresWork } from '../../api/databaseRemoval';
import { withNativePostgresNames } from './nativeNames';

/** 平台建的库与角色都以 `cs_` 开头（生产库 cs_<slug>、开发库 cs_<slug>_dev、临时角色 cs_t_…）；平台自己的库与角色不在内。 */
const PREFIX = 'cs\\_%';

/** 口令直接写进语句（CREATE ROLE 不收参数）：只收平台生成的 base64url，别的字符一律拒绝。 */
function checkPassword(password: string): void {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(password)) throw new Error('口令格式不对，拒绝写进数据面');
}

const ident = (name: string): string => {
  if (!/^cs_[a-z0-9_]{1,60}$/.test(name)) throw new Error(`非法的数据面标识符：${name}`);
  return `"${name}"`;
};

/**
 * 数据面：用与 data 供给同一个管理连接。快照是只读查询（pg_database、pg_roles）；写有删访问绑定的临时角色与建库建角色（I28）。
 * 连接用 postgres.js（RFC-023），服务端提示不打印。
 */
export function postgresDataPlane(adminUrl: string, clock: { now(): Date } = { now: () => new Date() }, work?: NativePostgresWork): DataPlaneReader & DataPlaneWriter {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  const run = async <T>(origin: NativePostgresOrigin | undefined, names: readonly string[], effect: (connection: NativeDdlConnection) => Promise<T>) => {
    for (const name of names) ident(name);
    if (work && !origin) throw precondition('原数据库写入缺少项目和资源身份');
    return work ? work.run(origin!, names, effect) : withNativePostgresNames(adminUrl, names, effect);
  };
  return {
    rotatePassword: ({ role, password, origin }) => run(origin, [role], async (connection) => {
      checkPassword(password);
      if ((await connection.query('SELECT 1 FROM pg_stat_activity WHERE usename=$1 LIMIT 1', [role])).length) throw conflict('数据库角色仍有连接，请结束使用者后重试轮换');
      await connection.query(`ALTER ROLE ${ident(role)} WITH PASSWORD '${password}'`);
    }),
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
    dropRole: ({ role, oid, database, reassignTo, origin }) => run(origin, [role, ...database ? [database] : [], ...reassignTo ? [reassignTo] : []], async (connection) => {
      const quoted = ident(role);
      const current = await connection.query<{ oid: string }[]>('SELECT oid::text AS oid FROM pg_roles WHERE rolname=$1', [role]);
      if (!current[0]) return 'absent';
      if (oid && current[0].oid !== oid) return 'replaced';
      await connection.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=$1', [role]);
      if (database) {
        const target = new URL(adminUrl);
        target.pathname = `/${database}`;
        const inDb = postgres(target.toString(), { max: 1, onnotice: () => undefined });
        try {
          await connection.assertHeld();
          if (reassignTo) await inDb.unsafe(`REASSIGN OWNED BY ${quoted} TO ${ident(reassignTo)}`);
          await connection.assertHeld();
          await inDb.unsafe(`DROP OWNED BY ${quoted}`);
        } finally {
          await inDb.end();
        }
      }
      await connection.query(`DROP OWNED BY ${quoted}`);
      await connection.query(`DROP ROLE ${quoted}`);
      return 'dropped';
    }),
    ensureDatabase: ({ database, role, password, origin }) => run(origin, [database, role], async (connection) => {
      checkPassword(password);
      const exists = (await connection.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).length > 0;
      await connection.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${ident(role)} WITH LOGIN PASSWORD '${password}'`);
      if (!(await connection.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).length) await connection.query(`CREATE DATABASE ${ident(database)} OWNER ${ident(role)}`);
      await connection.query(`REVOKE CONNECT ON DATABASE ${ident(database)} FROM PUBLIC`);
      await connection.query(`GRANT CONNECT ON DATABASE ${ident(database)} TO ${ident(role)}`);
    }),
    ensureTemporaryRole: ({ role, database, ownerRole, readOnly, validUntil, password, origin }) => run(origin, [role, database, ownerRole], async (connection) => {
      checkPassword(password);
      const until = new Date(validUntil);
      if (!Number.isFinite(until.getTime())) throw new Error('到期时间不对，拒绝写进数据面');
      const exists = (await connection.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).length > 0;
      await connection.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${ident(role)} WITH LOGIN PASSWORD '${password}' VALID UNTIL '${until.toISOString()}'`);
      await connection.query(`GRANT CONNECT ON DATABASE ${ident(database)} TO ${ident(role)}`);
      await connection.query(readOnly ? `GRANT pg_read_all_data TO ${ident(role)}` : `GRANT ${ident(ownerRole)} TO ${ident(role)}`);
    }),
    close: async () => { await admin.end(); },
  };
}
