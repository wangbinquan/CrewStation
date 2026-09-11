import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '@crewstation/kernel';
import { noopLogger } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import type { Database } from './connection';

export interface MigrationFile { name: string; sql: string }
/** 一个模块（或基础设施包）的迁移集合；按 layer、模块名、文件名顺序执行。 */
export interface MigrationSet { module: string; layer: number; files: MigrationFile[] }

const LOCK_KEY = 727001;

export function readMigrationDir(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
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
    for (const set of ordered(sets)) {
      for (const file of set.files) {
        const key = `${set.module}/${file.name}`;
        const checksum = new Bun.CryptoHasher('sha256').update(file.sql).digest('hex');
        const previous = seen.get(key);
        if (previous === checksum) continue;
        if (previous !== undefined) throw new Error(`迁移 ${key} 已应用但内容已变化；迁移文件不可修改，只能新增`);
        await tx.execute(sql.raw(file.sql));
        await tx.execute(sql`INSERT INTO platform_infra.migrations (module, name, checksum) VALUES (${set.module}, ${file.name}, ${checksum})`);
        applied.push(key);
        logger.info('migration applied', { migration: key });
      }
    }
  });
  return applied;
}

function ordered(sets: MigrationSet[]): MigrationSet[] {
  return [...sets].sort((a, b) => a.layer - b.layer || a.module.localeCompare(b.module));
}

function rowsOf(result: unknown): Array<{ module: string; name: string; checksum: string }> {
  return (Array.isArray(result) ? result : []) as Array<{ module: string; name: string; checksum: string }>;
}
