import postgres from 'postgres';
import { precondition } from '@crewstation/kernel';
import type { PostgresDdlConnection, PostgresNativeWork, PostgresProvider } from '../../ports/providers';

export interface PostgresProviderSettings {
  /** 管理连接（超级用户或 CREATEDB/CREATEROLE），只在控制面进程内使用。 */
  adminUrl: string;
  /** 业务容器看到的主机与端口。 */
  visibleHost: string;
  visiblePort: number;
}

const ident = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error(`非法的数据库标识符：${name}`);
  return `"${name}"`;
};

/** 业务容器用的连接串：角色、口令、库，主机与端口是容器看得到的那一组（data-control 建的库也用它拼，RFC-025 I28）。 */
export function postgresDsn(settings: Pick<PostgresProviderSettings, 'visibleHost' | 'visiblePort'>, role: string, pass: string, db: string): string {
  return `postgres://${encodeURIComponent(role)}:${encodeURIComponent(pass)}@${settings.visibleHost}:${settings.visiblePort}/${db}`;
}

/**
 * 每服务一库一角色；新库撤销 PUBLIC 的 CONNECT，保证跨项目不可连（AT-12）。
 * 临时角色用 VALID UNTIL 让数据库自己执行到期；只读经 pg_read_all_data，但只对该库有 CONNECT。
 * 连接用 postgres.js（RFC-023，替换 Bun 内置 SQL）；服务端提示不打印。
 */
export function postgresJsProvider(settings: PostgresProviderSettings, work?: PostgresNativeWork): PostgresProvider {
  const dsn = (role: string, pass: string, db: string): string => postgresDsn(settings, role, pass, db);
  const roleExists = async (connection: PostgresDdlConnection, role: string) => (await connection.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).length > 0;
  const original = (origin: Parameters<PostgresNativeWork['credential']>[0] | undefined) => {
    if (!work || !origin?.projectId || !origin.resourceId) throw precondition('旧数据库供给缺少原项目写入与口令持久端口');
    return origin;
  };
  return {
    provisionDatabase: async ({ databaseName, roleName, origin }) => {
      const source = original(origin), { password: pass } = await work!.credential(source, roleName);
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(pass)) throw precondition('原数据库口令格式不合法');
      return work!.run(source, [databaseName, roleName], async (connection) => {
        const exists = await roleExists(connection, roleName);
        await connection.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${ident(roleName)} WITH LOGIN PASSWORD '${pass}'`);
        if (!(await connection.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName])).length) await connection.query(`CREATE DATABASE ${ident(databaseName)} OWNER ${ident(roleName)}`);
        await connection.query(`REVOKE CONNECT ON DATABASE ${ident(databaseName)} FROM PUBLIC`);
        await connection.query(`GRANT CONNECT ON DATABASE ${ident(databaseName)} TO ${ident(roleName)}`);
        return { dsn: dsn(roleName, pass, databaseName) };
      });
    },
    createTemporaryRole: async ({ databaseName, roleName, ownerRole, readOnly, validUntil, origin }) => {
      const source = original(origin), { password: pass } = await work!.credential(source, roleName);
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(pass)) throw precondition('原数据库口令格式不合法');
      const until = validUntil.toISOString();
      return work!.run(source, [databaseName, roleName, ownerRole], async (connection) => {
        const exists = await roleExists(connection, roleName);
        await connection.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${ident(roleName)} WITH LOGIN PASSWORD '${pass}' VALID UNTIL '${until}'`);
        await connection.query(`GRANT CONNECT ON DATABASE ${ident(databaseName)} TO ${ident(roleName)}`);
        await connection.query(readOnly ? `GRANT pg_read_all_data TO ${ident(roleName)}` : `GRANT ${ident(ownerRole)} TO ${ident(roleName)}`);
        return { dsn: dsn(roleName, pass, databaseName) };
      });
    },
    dropRole: async ({ roleName, databaseName, reassignTo, origin }) => {
      const source = original(origin);
      return work!.run(source, [roleName, ...databaseName ? [databaseName] : [], ...reassignTo ? [reassignTo] : []], async (connection) => {
      if (!(await roleExists(connection, roleName))) return;
      await connection.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=$1', [roleName]);
      if (databaseName) {
        const target = new URL(settings.adminUrl);
        target.pathname = `/${databaseName}`;
        const inDb = postgres(target.toString(), { max: 1, onnotice: () => undefined });
        try {
          await connection.assertHeld();
          if (reassignTo) await inDb.unsafe(`REASSIGN OWNED BY ${ident(roleName)} TO ${ident(reassignTo)}`);
          await connection.assertHeld();
          await inDb.unsafe(`DROP OWNED BY ${ident(roleName)}`);
        } finally {
          await inDb.end();
        }
      }
      await connection.query(`DROP OWNED BY ${ident(roleName)}`);
      await connection.query(`DROP ROLE ${ident(roleName)}`);
      });
    },
    dropDatabase: async () => { throw precondition('原数据库删除必须由清理 owner 核对正式许可、原 OID 与物理来源'); },
  };
}
