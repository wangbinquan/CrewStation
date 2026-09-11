import { SQL } from 'bun';
import type { PostgresProvider } from '../../ports/providers';

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
const password = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');

/**
 * 每服务一库一角色；新库撤销 PUBLIC 的 CONNECT，保证跨项目不可连（AT-12）。
 * 临时角色用 VALID UNTIL 让数据库自己执行到期；只读经 pg_read_all_data，但只对该库有 CONNECT。
 */
export function bunSqlPostgresProvider(settings: PostgresProviderSettings): PostgresProvider {
  const admin = new SQL(settings.adminUrl, { max: 2 });
  const dsn = (role: string, pass: string, db: string): string => `postgres://${encodeURIComponent(role)}:${encodeURIComponent(pass)}@${settings.visibleHost}:${settings.visiblePort}/${db}`;
  const roleExists = async (role: string): Promise<boolean> => (await admin`SELECT 1 FROM pg_roles WHERE rolname = ${role}`).length > 0;
  return {
    provisionDatabase: async ({ databaseName, roleName }) => {
      const pass = password();
      if (await roleExists(roleName)) await admin.unsafe(`ALTER ROLE ${ident(roleName)} WITH LOGIN PASSWORD '${pass}'`);
      else await admin.unsafe(`CREATE ROLE ${ident(roleName)} WITH LOGIN PASSWORD '${pass}'`);
      const dbExists = (await admin`SELECT 1 FROM pg_database WHERE datname = ${databaseName}`).length > 0;
      if (!dbExists) await admin.unsafe(`CREATE DATABASE ${ident(databaseName)} OWNER ${ident(roleName)}`);
      await admin.unsafe(`REVOKE CONNECT ON DATABASE ${ident(databaseName)} FROM PUBLIC`);
      await admin.unsafe(`GRANT CONNECT ON DATABASE ${ident(databaseName)} TO ${ident(roleName)}`);
      return { dsn: dsn(roleName, pass, databaseName) };
    },
    createTemporaryRole: async ({ databaseName, roleName, ownerRole, readOnly, validUntil }) => {
      const pass = password();
      const until = validUntil.toISOString();
      if (await roleExists(roleName)) await admin.unsafe(`DROP ROLE ${ident(roleName)}`);
      await admin.unsafe(`CREATE ROLE ${ident(roleName)} WITH LOGIN PASSWORD '${pass}' VALID UNTIL '${until}'`);
      await admin.unsafe(`GRANT CONNECT ON DATABASE ${ident(databaseName)} TO ${ident(roleName)}`);
      await admin.unsafe(readOnly ? `GRANT pg_read_all_data TO ${ident(roleName)}` : `GRANT ${ident(ownerRole)} TO ${ident(roleName)}`);
      return { dsn: dsn(roleName, pass, databaseName) };
    },
    dropRole: async ({ roleName, databaseName, reassignTo }) => {
      if (!(await roleExists(roleName))) return;
      await admin.unsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '${roleName.replace(/'/g, "''")}'`);
      if (databaseName) {
        const target = new URL(settings.adminUrl);
        target.pathname = `/${databaseName}`;
        const inDb = new SQL(target.toString(), { max: 1 });
        try {
          if (reassignTo) await inDb.unsafe(`REASSIGN OWNED BY ${ident(roleName)} TO ${ident(reassignTo)}`);
          await inDb.unsafe(`DROP OWNED BY ${ident(roleName)}`);
        } finally {
          await inDb.close();
        }
      }
      await admin.unsafe(`DROP OWNED BY ${ident(roleName)}`);
      await admin.unsafe(`DROP ROLE ${ident(roleName)}`);
    },
    dropDatabase: async (databaseName) => { await admin.unsafe(`DROP DATABASE IF EXISTS ${ident(databaseName)} WITH (FORCE)`); },
  };
}
