import type { ProjectId } from '@crewstation/contracts';

interface PostgresOrigin { readonly projectId: ProjectId; readonly resourceId: string }
export interface PostgresDdlConnection {
  query<T extends Record<string, unknown>[] = Record<string, unknown>[]>(text: string, parameters?: readonly (string | number | boolean | null)[]): Promise<T>;
  assertHeld(): Promise<void>;
}
/** Internal original-resource port, supplied by the composition root. */
export interface PostgresNativeWork {
  run<T>(origin: PostgresOrigin, names: readonly string[], effect: (connection: PostgresDdlConnection) => Promise<T>): Promise<T>;
  credential(origin: PostgresOrigin, role: string): Promise<{ role: string; password: string }>;
}

/** PostgreSQL 供给：在平台数据库集群上为服务建库建角色；只做 DDL，不碰业务数据。 */
export interface PostgresProvider {
  provisionDatabase(spec: { databaseName: string; roleName: string; origin?: PostgresOrigin }): Promise<{ dsn: string }>;
  /** 临时角色：只读用 pg_read_all_data，可写则继承运行角色；validUntil 由数据库执行到期。 */
  createTemporaryRole(spec: { databaseName: string; roleName: string; ownerRole: string; readOnly: boolean; validUntil: Date; origin?: PostgresOrigin }): Promise<{ dsn: string }>;
  /** 删除临时角色：先在目标库里把它拥有的对象转给运行角色并撤销授权，再 DROP ROLE。 */
  dropRole(spec: { roleName: string; databaseName?: string; reassignTo?: string; origin?: PostgresOrigin }): Promise<void>;
  dropDatabase(databaseName: string, origin?: PostgresOrigin): Promise<void>;
}

export interface SecretCipher {
  encrypt(plain: string): Promise<string>;
  decrypt(boxed: string): Promise<string>;
}
