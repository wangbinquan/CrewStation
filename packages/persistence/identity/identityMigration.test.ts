import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { readMigrationDir, runMigrations } from '../migrations';
import type { MigrationFile, MigrationSet } from '../migrations';
import type { ResourceIdentityMigration } from './model';
import { UUID_V7_PATTERN } from './identityMap';

const available = await testDatabaseAvailable();
const oldId = 'prj_00000000000000000000000000000001';
const original = { projectId: oldId, payload: { projectId: oldId }, script: oldId };
const initial: MigrationSet[] = [
  { module: 'consumer', layer: 1, files: [{ name: '0001_initial.sql', sql: `CREATE SCHEMA consumer; CREATE TABLE consumer.tasks (id text PRIMARY KEY, project_id text, snapshot jsonb, normalized jsonb);` }] },
  { module: 'owner', layer: 2, files: [{ name: '0001_initial.sql', sql: 'CREATE SCHEMA owner; CREATE TABLE owner.projects (id text PRIMARY KEY, name text);' }] },
];
const owner: ResourceIdentityMigration = { version: 'resource-identity/v1', schema: 'owner', entities: [{ table: 'projects', kind: 'project', keys: ['id'], idColumn: 'id' }], references: [] };
const consumer: ResourceIdentityMigration = {
  version: 'resource-identity/v1', schema: 'consumer', entities: [{ table: 'tasks', kind: 'task', keys: ['id'], idColumn: 'id' }],
  references: [{ table: 'tasks', column: 'project_id', kind: 'project', keys: ['project_id'] }],
  documents: [{ table: 'tasks', column: 'snapshot', targetColumn: 'normalized', references: [{ path: 'projectId', kind: 'project' }] }],
};
const dataFile = (identity: ResourceIdentityMigration): MigrationFile => ({ name: '0002_resource_identity.identity.json', source: JSON.stringify(identity), identity });
const upgrade = (definition = consumer): MigrationSet[] => initial.map((set) => ({ ...set, files: [...set.files, dataFile(set.module === 'owner' ? owner : definition)] }));

test('SQL 与身份迁移文件按原始文本读取并排序，其他文件忽略', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-identity-migration-'));
  try {
    writeFileSync(join(dir, '0002_resource_identity.identity.json'), JSON.stringify(owner));
    writeFileSync(join(dir, '0001_initial.sql'), 'SELECT 1;');
    writeFileSync(join(dir, 'README.md'), 'not a migration');
    expect(readMigrationDir(dir)).toEqual([{ name: '0001_initial.sql', sql: 'SELECT 1;' }, dataFile(owner)]);
  } finally { rmSync(dir, { recursive: true }); }
});

describe.skipIf(!available)('资源身份事务升级', () => {
  test('先建全局映射再改跨模块引用，原始快照保留；重跑幂等，后续 SQL 在转换后执行', async () => {
    const tdb = await createTestDatabase(initial);
    try {
      await tdb.db.execute(sql`INSERT INTO owner.projects VALUES (${oldId}, 'old name')`);
      await tdb.db.execute(sql`INSERT INTO consumer.tasks VALUES ('tsk_old', ${oldId}, ${JSON.stringify(original)}::text::jsonb, NULL)`);
      const sets = upgrade().map((set) => set.module === 'consumer' ? { ...set, files: [...set.files, {
        name: '0003_after_identity.sql', sql: "ALTER TABLE consumer.tasks ADD CONSTRAINT normalized_identity CHECK (normalized->>'projectId' = project_id);",
      }] } : set);
      expect(await runMigrations(tdb.db, sets)).toEqual(['consumer/0002_resource_identity.identity.json', 'owner/0002_resource_identity.identity.json', 'consumer/0003_after_identity.sql']);
      const rows = await tdb.db.execute(sql`SELECT t.id, p.id AS project_id, t.project_id AS reference, t.snapshot, t.normalized FROM consumer.tasks t JOIN owner.projects p ON p.id = t.project_id`) as unknown as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toMatch(UUID_V7_PATTERN);
      expect(rows[0]!.project_id).toMatch(UUID_V7_PATTERN);
      expect(rows[0]!.reference).toBe(rows[0]!.project_id);
      expect(rows[0]!.snapshot).toEqual(original);
      expect(rows[0]!.normalized).toEqual({ ...original, projectId: rows[0]!.project_id });
      expect(await runMigrations(tdb.db, sets)).toEqual([]);
      const aliases = await tdb.db.execute(sql`SELECT id FROM owner.resource_identity_aliases`);
      expect([...aliases]).toEqual([{ id: rows[0]!.project_id }]);
      await expect(runMigrations(tdb.db, upgrade({ ...consumer, finalize: ['SELECT 1'] }))).rejects.toThrow('不可修改');
    } finally { await tdb.drop(); }
  });

  test('孤儿引用与后置约束失败都回滚资源、映射表和迁移记录，修复后可重试', async () => {
    const tdb = await createTestDatabase(initial);
    try {
      await tdb.db.execute(sql`INSERT INTO consumer.tasks VALUES ('tsk_old', ${oldId}, ${JSON.stringify(original)}::text::jsonb, NULL)`);
      await expect(runMigrations(tdb.db, upgrade())).rejects.toThrow('Unresolved resource identity');
      expect([...(await tdb.db.execute(sql`SELECT id, project_id, normalized FROM consumer.tasks`))]).toEqual([{ id: 'tsk_old', project_id: oldId, normalized: null }]);
      expect([...(await tdb.db.execute(sql`SELECT to_regclass('owner.resource_identity_aliases') AS table_name`))]).toEqual([{ table_name: null }]);
      await tdb.db.execute(sql`INSERT INTO owner.projects VALUES (${oldId}, 'old name')`);
      await expect(runMigrations(tdb.db, upgrade({ ...consumer, finalize: ['SELECT 1/0'] }))).rejects.toThrow();
      expect([...(await tdb.db.execute(sql`SELECT id FROM owner.projects`))]).toEqual([{ id: oldId }]);
      expect([...(await tdb.db.execute(sql`SELECT count(*)::int AS n FROM platform_infra.migrations`))]).toEqual([{ n: 2 }]);
      expect(await runMigrations(tdb.db, upgrade())).toHaveLength(2);
    } finally { await tdb.drop(); }
  });

  test('模块不能声明别人的表空间；现存 UUIDv7 与内联资源的作用域保持一致', async () => {
    const tdb = await createTestDatabase(initial);
    try {
      await expect(runMigrations(tdb.db, upgrade({ ...consumer, schema: 'owner' }))).rejects.toThrow('本模块 schema');
      const id = Bun.randomUUIDv7();
      await tdb.db.execute(sql`INSERT INTO owner.projects VALUES (${id}, 'old name')`);
      await tdb.db.execute(sql`INSERT INTO consumer.tasks VALUES ('tsk_old', ${id}, ${JSON.stringify({ steps: [{ stepId: 'one' }, { stepId: 'two' }] })}::text::jsonb, NULL)`);
      await runMigrations(tdb.db, upgrade({ ...consumer,
        inlineEntities: [{ table: 'tasks', column: 'snapshot', path: 'steps.*.stepId', kind: 'step', keys: ['$row.id', '$value'] }],
        documents: [{ table: 'tasks', column: 'snapshot', targetColumn: 'normalized', references: [{ path: 'steps.*.stepId', kind: 'step', keys: ['$row.id', '$value'] }] }],
      }));
      expect([...(await tdb.db.execute(sql`SELECT id FROM owner.projects`))]).toEqual([{ id }]);
      const rows = await tdb.db.execute(sql`SELECT normalized FROM consumer.tasks`) as unknown as { normalized: { steps: { stepId: string }[] } }[];
      expect(rows[0]!.normalized.steps).toHaveLength(2);
      expect(new Set(rows[0]!.normalized.steps.map((step) => step.stepId)).size).toBe(2);
      expect(rows[0]!.normalized.steps[0]!.stepId).toMatch(UUID_V7_PATTERN);
    } finally { await tdb.drop(); }
  });
});
