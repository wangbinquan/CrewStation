import type { ProjectDeletionInventory, ProjectDeletionTarget, ProjectId } from '@crewstation/contracts';
import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { DATA_CONTENT, DATA_SHARED } from '../../domain/deletionContents';
import type { DataDeletionContent, DataDeletionIdentity, DataDeletionLocation, DataDeletionOrigin, DataDeletionScope, DataDeletionSources } from '../../ports/deletion/projectDeletion';

export async function registeredDataContent(db: Executor) {
  const rows = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='data' AND table_type='BASE TABLE'`);
  const allowed: readonly string[] = [...DATA_CONTENT.map(t => t.table), ...DATA_SHARED, 'project_deletions','content_origins'];
  if (rows.some(r => !allowed.includes(r.table_name)) || allowed.some(table => !rows.some(r => r.table_name === table))) throw precondition('data has missing or unregistered content tables');
}
interface Row extends Record<string, unknown> { key: string; digest: string; project: string | null; service: string | null; task: string | null; invalid: boolean; body: unknown }
export async function inspectDataContent(db: Executor, sources: DataDeletionSources, target: ProjectDeletionTarget): Promise<{ inventory: ProjectDeletionInventory; scope: DataDeletionScope }> {
  await registeredDataContent(db);
  const origins = new Map<string, DataDeletionIdentity>(), resolved = new Map<string, Promise<DataDeletionOrigin>>();
  const origin = (kind: 'project' | 'service' | 'task', key: string) => {
    const cache = kind + ':' + key;
    if (!resolved.has(cache)) resolved.set(cache, (async () => {
      let fact = await sources.resolve(kind, key);
      if (!fact) {
        const retained = (await db.execute<{ id: string; project_id: ProjectId }>(sql`SELECT o.id,o.project_id FROM data.content_origins o INNER JOIN data.project_deletions d ON d.project_id=o.project_id WHERE o.kind=${kind} AND o.key=${key} AND d.verified AND d.body->>'compacted'='true'`))[0];
        if (retained) fact = { complete: true, id: retained.id, projectId: retained.project_id };
      }
      if (!fact?.complete || !ResourceIdSchema.safeParse(fact.id).success || !ProjectIdSchema.safeParse(fact.projectId).success) throw precondition('data original ownership source is incomplete');
      if (fact.projectId === target.id) origins.set(cache, { kind, key, id: fact.id, projectId: fact.projectId });
      return fact;
    })());
    return resolved.get(cache)!;
  };
  const contents: DataDeletionContent[] = [], resources: ProjectDeletionInventory['resources'] = [], locations = new Map<string, DataDeletionLocation>();
  const releases = new Map<string, { backendId: string; bytes: number; transfers: number }>();
  await origin('project', target.id);
  if (target.serviceId && (await origin('service',target.serviceId)).projectId !== target.id) throw precondition('data target service ownership conflicts');
  let objectsPresent = false;
  for (const entry of DATA_CONTENT) {
    const selected: DataDeletionContent[] = [], key = sql.raw('jsonb_build_array(' + entry.keys.map(column => 'r.' + column).join(',') + ')::text');
    let after: string | null = null;
    const field = (value?: string) => sql.raw(value ?? 'NULL::text');
    for (;;) {
      const rows: Row[] = await db.execute<Row>(sql`SELECT ${key} AS key,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS digest,${field(entry.project)} AS project,${field(entry.service)} AS service,${field(entry.task)} AS task,${sql.raw(entry.invalid ?? 'false')} AS invalid,${entry.physical || entry.table === 'object_references' ? sql`to_jsonb(r)` : sql`NULL::jsonb`} AS body
        FROM ${sql.raw(entry.from ?? 'data.' + entry.table + ' r')} WHERE ${after === null ? sql`true` : sql`${key} COLLATE "C">${after} COLLATE "C"`} ORDER BY ${key} COLLATE "C" LIMIT 200`);
      if (!rows.length) break;
      for (const row of rows) {
        if (row.invalid || after !== null && Buffer.compare(Buffer.from(row.key),Buffer.from(after)) <= 0) throw precondition('data original parent or complete traversal is inconsistent');
        const facts = await Promise.all([...(entry.project ? [origin('project', requireKey(row.project))] : []), ...(entry.service ? [origin('service',requireKey(row.service))] : []), ...(entry.task ? [origin('task',requireKey(row.task))] : [])]);
        const first = facts[0];
        if (!first || facts.some(f => f.projectId !== first.projectId)) throw precondition('data original project, service or task ownership conflicts');
        if (first.projectId === target.id) {
          selected.push({ table: entry.table, key: row.key, digest: row.digest });
          if (entry.origin) origins.set(entry.origin + ':' + row.key, { kind: entry.origin, key: String(JSON.parse(row.key)[0]), id: String(JSON.parse(row.key)[0]), projectId: target.id });
          objectsPresent ||= Boolean(entry.physical);
          if (entry.table === 'objects' || entry.table === 'object_upload_attempts' || entry.table === 'object_work') addLocation(locations, row.body,entry.table);
          if (entry.table === 'object_upload_attempts' || entry.table === 'object_read_transfers') addReservation(releases,entry.table,row.body);
          if (entry.table === 'object_references') await assertReference(db,sources, row.body, target.id);
        }
        after = row.key;
      }
    }
    contents.push(...selected);
    resources.push({ kind: 'data-content', id: entry.table, identity: jsonHash(selected), sourceIdentity: jsonHash({ project: target.id, table: entry.table, keys: selected.map(r => r.key) }), count: selected.length, scope: 'metadata' });
  }
  // These bundles contain a full control database snapshot; deleting a shared backup would affect other projects.
  const backups = await db.execute(sql`SELECT id FROM data.object_backups LIMIT 1`);
  if (backups.length) throw precondition('shared full database backups require scoped project erasure evidence');
  const digest = jsonHash({ project: target.id, contents });
  const scope: DataDeletionScope = { contents, origins: [...origins.values()], locations: [...locations.values()], backendReleases: [...releases.values()], objectsPresent, digest, count: contents.length, compacted: false };
  return { inventory: { participant: 'data', revision: jsonHash({ project: target.id, resources }), complete: true, resources, references: [], blockers: [] }, scope };
}
function requireKey(value: string | null) { if (!value) throw precondition('data original ownership key is missing'); return value; }
function addLocation(locations: Map<string, DataDeletionLocation>, raw: unknown, table: string) {
  const record = raw as { space_id?: string; body?: Record<string, unknown> }, body = record?.body;
  if (!body || typeof body['backendId'] !== 'string' || typeof body['key'] !== 'string' || !body['key'] || !Number.isSafeInteger(body['placementRevision']) || Number(body['placementRevision']) < 1 || !Number.isSafeInteger(body['size']) || Number(body['size']) < 0) throw precondition('data original byte location is invalid');
  const attempt = table === 'object_upload_attempts' ? body['id'] : body['attemptId'], spaceId = table === 'object_work' ? body['spaceId'] : record.space_id;
  if (!ResourceIdSchema.safeParse(spaceId).success || !ResourceIdSchema.safeParse(attempt).success || body['key'] !== `spaces/${spaceId}/attempts/${attempt}`) throw precondition('data native key is outside the original space and attempt');
  const item: DataDeletionLocation = { backendId: body['backendId'], key: body['key'], placementRevision: Number(body['placementRevision']), size: Number(body['size']) };
  const key = JSON.stringify([item.backendId,item.placementRevision,item.key]), old = locations.get(key);
  if (old && old.size !== item.size) throw precondition('data original byte locations conflict');
  locations.set(key,item);
}
async function assertReference(db: Executor, sources: DataDeletionSources, raw: unknown, projectId: ProjectId) {
  const row = raw as { object_id: string; owner_type: string; owner_id: string; body: { state?: string } };
  if (!row.body || !['active','released'].includes(String(row.body.state))) throw precondition('data object reference state is unknown');
  if (row.body.state === 'released') return;
  let source: DataDeletionOrigin | undefined;
  if (['archive-pending','archive-receipt','finalization-guard'].includes(row.owner_type)) {
    const original = (await db.execute<{ task_id: string }>(sql`SELECT b.task_id FROM data.finalization_bindings b INNER JOIN data.objects o ON o.space_id=b.space_id WHERE b.id=${row.owner_id} AND o.id=${row.object_id}`))[0];
    if (original) source = await sources.resolve('task',original.task_id);
  } else source = await sources.reference?.(row.owner_type,row.owner_id);
  if (!source?.complete || source.projectId !== projectId) throw precondition('data object reference ownership is unknown or shared with another project');
}
function addReservation(releases: Map<string, { backendId: string; bytes: number; transfers: number }>, table: string, raw: unknown) {
  const body = (raw as { body: Record<string, unknown> }).body;
  if (typeof body['backendId'] !== 'string') throw precondition('data backend reservation source is missing');
  const key = body['backendId'], old = releases.get(key) ?? { backendId: key, bytes: 0, transfers: 0 };
  const bytes = table === 'object_upload_attempts' && body['state'] !== 'deleted' ? Number(body['size']) : 0;
  const active = table === 'object_read_transfers' ? body['endedAt'] === null : body['state'] === 'verifying' || ['streaming','unknown'].includes(String(body['state'])) && body['writerEndedAt'] === null;
  const value = { backendId: key, bytes: old.bytes + bytes, transfers: old.transfers + Number(active) };
  if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(value.bytes) || !Number.isSafeInteger(value.transfers)) throw precondition('data backend reservation counters are invalid');
  releases.set(key,value);
}
