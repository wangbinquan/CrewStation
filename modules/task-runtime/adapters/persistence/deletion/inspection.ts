import { ProjectIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { RuntimeDeletionContent } from '../../../domain/deletion/content';
import type { RuntimeDeletionSources } from '../../../ports/deletion/sources';
import { RUNTIME_CONTENT, RUNTIME_RETAINED } from './contentTables';
import { RuntimeContentSources } from './contentSources';
import { runtimeContentOwnership } from './contentRelations';
import { runtimeContentKey, runtimeDocumentInvalid } from './rowStore';
import type { RuntimeContentRow, RuntimeContentTable } from './rowStore';

export async function registeredRuntimeContent(db: Executor) {
  const known = [...RUNTIME_CONTENT, ...RUNTIME_RETAINED];
  const tables = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='task_runtime' AND table_type='BASE TABLE'`);
  if (tables.length !== known.length || tables.some((row) => !known.some((entry) => entry.table === row.table_name)))
    throw precondition('运行环境存在未登记或缺失的内容表，不能确认全部清理范围');
  for (const entry of known) {
    const columns = await db.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns
      WHERE table_schema='task_runtime' AND table_name=${entry.table} ORDER BY column_name`);
    if (jsonHash(columns.map((row) => row.column_name)) !== jsonHash(entry.columns)) throw precondition('运行环境内容或最小共享事实列存在未登记变化');
  }
  const aliases = await db.execute(sql`SELECT 1 FROM task_runtime.resource_identity_aliases WHERE kind IN('task','rebuild','parent-ending','project','service','agent','runner','terminal')
    AND jsonb_array_length(key::jsonb)=1 AND key::jsonb->>0 ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND id IS DISTINCT FROM key::jsonb->>0 LIMIT 1`);
  if (aliases.length) throw precondition('运行环境当前原标识目录冲突');
}
async function inspectTable(db: Executor, entry: RuntimeContentTable, sources: RuntimeContentSources, project: ProjectId) {
  const key = runtimeContentKey(entry), contents: RuntimeDeletionContent[] = [];
  // Exit proof advances after seal. Its validity is checked separately; only the immutable birth belongs to the frozen content CAS.
  const body = sql.raw(entry.table === 'original_callbacks' ? "to_jsonb(r)-ARRAY['exited_at','exit_digest','recovery_digest']" : 'to_jsonb(r)');
  let after: string | null = null, count = 0;
  for (;;) {
    const rows: RuntimeContentRow[] = await db.execute<RuntimeContentRow>(sql`SELECT ${key} AS key,to_jsonb(r) AS body,${runtimeDocumentInvalid(entry)} AS invalid,
      encode(sha256(convert_to((${body})::text,'UTF8')),'hex') AS digest FROM ${sql.raw('task_runtime.' + entry.table)} r
      WHERE ${after === null ? sql`true` : sql`${key} COLLATE "C">${after} COLLATE "C"`} ORDER BY ${key} COLLATE "C" LIMIT 200`);
    if (!rows.length) break;
    for (const row of rows) {
      if (row.invalid) throw precondition('运行环境原内容存在显式无效的 JSON 关系');
      sources.rows.prime(entry.table, row.body);
    }
    for (const row of rows) {
      if (after !== null && Buffer.compare(Buffer.from(row.key), Buffer.from(after)) <= 0) throw precondition('运行环境内容完整分页不符');
      const ownership = await runtimeContentOwnership(entry.table, row.body, sources);
      if (ownership.origin.scope === 'project' && ownership.origin.projectIds[0] === project)
        contents.push({ table: entry.table, key: row.key, digest: row.digest, ownership: ownership.digest });
      after = row.key; count++;
    }
  }
  return { contents, count };
}
export async function inspectRuntimeContent(db: Executor, publicSources: RuntimeDeletionSources, rawProject: ProjectId) {
  const project = ProjectIdSchema.parse(rawProject), sources = new RuntimeContentSources(db, publicSources, project);
  const contents: RuntimeDeletionContent[] = [], resources: ProjectDeletionInventory['resources'] = [], counts: Record<string, number> = {};
  await registeredRuntimeContent(db); await sources.root('project', project);
  for (const entry of RUNTIME_CONTENT) {
    const inspected = await inspectTable(db, entry, sources, project); contents.push(...inspected.contents); counts[entry.table] = inspected.count;
    if (inspected.contents.length) resources.push({ kind: 'task-runtime-content', id: entry.table, scope: 'metadata', count: inspected.contents.length,
      identity: jsonHash(inspected.contents), sourceIdentity: jsonHash(inspected.contents.map(({ key, ownership }) => ({ key, ownership }))) });
  }
  const inventory: ProjectDeletionInventory = { participant: 'task-runtime', complete: true, resources, references: [], blockers: [], revision: jsonHash({ project, resources }) };
  return { inventory, contents, origins: sources.listOrigins(), traversal: { complete: true as const, counts, digest: jsonHash({ project, contents }) } };
}
export function runtimeContentSnapshot(db: Database, sources: RuntimeDeletionSources, project: ProjectId) {
  return db.transaction((tx) => inspectRuntimeContent(tx, sources, project), { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
