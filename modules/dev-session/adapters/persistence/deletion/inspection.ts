import { ProjectIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { readTransactionPages } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { DevelopmentDeletionContent, DevelopmentDeletionOrigin } from '../../../domain/deletion/content';
import type { DevelopmentDeletionSources } from '../../../ports/deletion/sources';
import { DEVELOPMENT_CONTENT } from './contentTables';
import { DevelopmentContentSources } from './contentSources';

type Entry = typeof DEVELOPMENT_CONTENT[number];
interface Row extends Record<string, unknown> {
  key: string; digest: string; workspace: string | null; runtime: string | null; previous: string | null;
  operation: string | null; project: string | null; invalid: boolean;
  agent: string | null; legacy_agent: string | null;
}
export async function registeredDevelopmentContent(db: Executor) {
  const known = new Set([...DEVELOPMENT_CONTENT.map(({ table }) => table), 'resource_identity_aliases',
    'project_admissions', 'callback_pod_stops', 'content_origins', 'project_deletions']);
  const tables = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='dev_session' AND table_type='BASE TABLE'`);
  if (tables.some((row) => !known.has(row.table_name)) || DEVELOPMENT_CONTENT.some(({ table }) => !tables.some((row) => row.table_name === table)))
    throw precondition('开发会话存在未登记或缺失的内容表，不能确认全部清理范围');
  for (const [table, columns] of Object.entries({ project_admissions: ['project_id', 'operation_id', 'generation', 'revision'],
    callback_pod_stops: ['identity', 'original_process', 'digest'], content_origins: ['kind', 'key', 'id', 'project_id', 'identity'],
    project_deletions: ['project_id', 'operation_id', 'generation', 'revision', 'body', 'phases', 'verified'] })) {
    const actual = await db.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns WHERE table_schema='dev_session' AND table_name=${table} ORDER BY column_name`);
    if (jsonHash(actual.map((row) => row.column_name)) !== jsonHash([...columns].sort())) throw precondition('开发最小封写或停止事实列发生未登记变化');
  }
  const aliases = await db.execute(sql`SELECT 1 FROM dev_session.resource_identity_aliases WHERE kind IN('task','agent','cluster-operation')
    AND jsonb_array_length(key::jsonb)=1 AND key::jsonb->>0 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND id IS DISTINCT FROM key::jsonb->>0 LIMIT 1`);
  if (aliases.length) throw precondition('开发当前对象的原标识目录冲突');
}
async function rowOwnership(entry: Entry, row: Row, sources: DevelopmentContentSources) {
  if (row.invalid || entry.workspace && !entry.optionalWorkspace && row.workspace === null) throw precondition('开发原内容关系或父记录不符');
  if (row.agent !== null) await sources.legacyAgent(row.legacy_agent, row.agent);
  const facts: DevelopmentDeletionOrigin[] = [];
  if (row.workspace !== null) facts.push(await sources.resolve('task', row.workspace));
  const operation = row.operation === null ? undefined : await sources.resolve('cluster-operation', row.operation);
  if (operation) facts.push(operation);
  if (row.runtime !== null) facts.push(operation ? await sources.reservedTask(row.runtime, operation) : await sources.resolve('task', row.runtime));
  if (row.previous !== null) facts.push(await sources.resolve('task', row.previous));
  if (row.project !== null) facts.push(await sources.resolve('project', row.project));
  const project = facts[0]?.projectIds[0];
  if (!project || facts.some((value) => value.scope !== 'project' || value.projectIds[0] !== project) || row.project !== null && ProjectIdSchema.parse(row.project) !== project)
    throw precondition('开发内容的原工作区、执行环境或管理操作项目归属冲突');
  return { project, digest: jsonHash(facts) };
}
async function inspectTable(db: Executor, entry: Entry, sources: DevelopmentContentSources, project: ProjectId) {
  let after: string | null = null, count = 0; const contents: DevelopmentDeletionContent[] = [];
  const field = (value?: string) => sql.raw(value ?? 'NULL::text');
  const key = sql.raw('jsonb_build_array(' + entry.keys.map((column) => 'r.' + column).join(',') + ')::text');
  const body = sql.raw(entry.table === 'original_callbacks' ? "to_jsonb(r)-ARRAY['exited_at','exit_digest','recovery_digest']" : 'to_jsonb(r)');
  await readTransactionPages<Row>(db, sql`SELECT ${key} AS key,encode(sha256(convert_to((${body})::text,'UTF8')),'hex') AS digest,
      ${field(entry.workspace)} AS workspace,${field(entry.runtime)} AS runtime,${field(entry.previous)} AS previous,
      ${field(entry.operation)} AS operation,${field(entry.project)} AS project,${field(entry.agent)} AS agent,${field(entry.legacyAgent)} AS legacy_agent,
      ${sql.raw(entry.invalid ?? 'false')} AS invalid
      FROM ${sql.raw(entry.from ?? 'dev_session.' + entry.table + ' r')}
      ORDER BY ${key} COLLATE "C"`, async (rows) => {
    for (const row of rows) {
      if (after !== null && Buffer.compare(Buffer.from(row.key), Buffer.from(after)) <= 0) throw precondition('开发内容完整分页不符');
      const ownership = await rowOwnership(entry, row, sources);
      if (ownership.project === project) contents.push({ table: entry.table, key: row.key, digest: row.digest, ownership: ownership.digest });
      count++; after = row.key;
    }
  });
  return { contents, count };
}
export async function inspectDevelopmentContent(db: Executor, rawSources: DevelopmentDeletionSources, rawProject: ProjectId) {
  const project = ProjectIdSchema.parse(rawProject), sources = new DevelopmentContentSources(db, rawSources, project);
  const contents: DevelopmentDeletionContent[] = [], resources: ProjectDeletionInventory['resources'] = [], counts: Record<string, number> = {};
  await registeredDevelopmentContent(db);
  for (const entry of DEVELOPMENT_CONTENT) {
    const inspected = await inspectTable(db, entry, sources, project); counts[entry.table] = inspected.count; contents.push(...inspected.contents);
    if (inspected.contents.length) resources.push({ kind: 'dev-session-content', id: entry.table, scope: 'metadata', count: inspected.contents.length,
      identity: jsonHash(inspected.contents), sourceIdentity: jsonHash(inspected.contents.map(({ key, ownership }) => ({ key, ownership }))) });
  }
  const inventory: ProjectDeletionInventory = { participant: 'dev-session', complete: true, resources, references: [], blockers: [], revision: jsonHash({ project, resources }) };
  return { inventory, contents, origins: sources.listOrigins(), traversal: { complete: true as const, counts, digest: jsonHash({ project, contents }) } };
}
export function developmentContentSnapshot(db: Database, sources: DevelopmentDeletionSources, project: ProjectId) {
  return db.transaction(async (tx) => { await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`); return inspectDevelopmentContent(tx, sources, project); });
}
