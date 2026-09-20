import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '@crewstation/kernel';
import { noopLogger } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import type { Database } from './connection';
import type { ResourceIdentityMigration } from './identity/model';
import { runResourceIdentityMigrations } from './identity/identityMigration';

export type MigrationFile = { name: string; sql: string } | { name: string; source: string; identity: ResourceIdentityMigration };
/** 一个模块（或基础设施包）的迁移集合；按 layer、模块名、文件名顺序执行。 */
export interface MigrationSet { module: string; layer: number; files: MigrationFile[] }

const LOCK_KEY = 727001;

export function readMigrationDir(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql') || name.endsWith('.identity.json'))
    .sort()
    .map((name) => {
      const source = readFileSync(join(dir, name), 'utf8');
      return name.endsWith('.sql') ? { name, sql: source } : { name, source, identity: JSON.parse(source) as ResourceIdentityMigration };
    });
}

/** 全部迁移在一个事务与一把事务级咨询锁内执行；已应用文件的校验和不得变化。 */
export async function runMigrations(db: Database, sets: MigrationSet[], logger: Logger = noopLogger): Promise<string[]> {
  const applied: string[] = [];
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
    await tx.execute(sql`CREATE SCHEMA IF NOT EXISTS platform_infra`);
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS platform_infra.migrations (
      module text NOT NULL, name text NOT NULL, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (module, name))`);
    const done = await tx.execute(sql`SELECT module, name, checksum FROM platform_infra.migrations`);
    const seen = new Map<string, string>(rowsOf(done).map((r) => [`${r.module}/${r.name}`, r.checksum]));
    const queues = ordered(sets).map((set) => ({ ...set, files: set.files.filter((file) => {
      const key = `${set.module}/${file.name}`, previous = seen.get(key);
      if (previous !== undefined && previous !== checksumOf(file)) throw new Error(`迁移 ${key} 已应用但内容已变化；迁移文件不可修改，只能新增`);
      if ('identity' in file && file.identity.schema !== schemaOf(set.module)) throw new Error(`迁移 ${key} 只能操作本模块 schema`);
      if ('identity' in file && file.identity.version !== 'resource-identity/v1') throw new Error(`迁移 ${key} 使用了不支持的身份迁移版本`);
      return previous === undefined;
    }) }));
    const allIdentities = sets.flatMap((set) => set.files.flatMap((file) => 'identity' in file ? [file.identity] : []));
    const record = async (module: string, file: MigrationFile): Promise<void> => {
      await tx.execute(sql`INSERT INTO platform_infra.migrations (module, name, checksum) VALUES (${module}, ${file.name}, ${checksumOf(file)})`);
      applied.push(`${module}/${file.name}`);
      logger.info('migration applied', { migration: `${module}/${file.name}` });
    };
    while (queues.some((set) => set.files.length)) {
      // Expansion precedes mapping across modules; later SQL waits until this identity barrier commits its changes.
      for (const set of queues) {
        while (set.files[0] && 'sql' in set.files[0]) {
          const file = set.files.shift()!;
          if ('sql' in file) await tx.execute(sql.raw(file.sql));
          await record(set.module, file);
        }
      }
      const batch = queues.flatMap((set) => set.files[0] && 'identity' in set.files[0] ? [{ module: set.module, file: set.files.shift()! }] : []);
      await runResourceIdentityMigrations(tx, batch.flatMap(({ file }) => 'identity' in file ? [file.identity] : []), allIdentities);
      for (const { module, file } of batch) await record(module, file);
    }
  });
  return applied;
}

function checksumOf(file: MigrationFile): string {
  return new Bun.CryptoHasher('sha256').update('sql' in file ? file.sql : file.source).digest('hex');
}

function schemaOf(module: string): string {
  return module.startsWith('platform_infra.') ? 'platform_infra' : module.replace(/-/g, '_');
}

function ordered(sets: MigrationSet[]): MigrationSet[] {
  return [...sets].sort((a, b) => a.layer - b.layer || a.module.localeCompare(b.module));
}

function rowsOf(result: unknown): Array<{ module: string; name: string; checksum: string }> {
  return (Array.isArray(result) ? result : []) as Array<{ module: string; name: string; checksum: string }>;
}
