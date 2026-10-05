import type { Executor } from '@crewstation/persistence';
import { ProjectDeletionInventorySchema, ProjectIdSchema, RuntimeImageExecutionSnapshotSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { DevelopmentPolicyRepository, LogRepository, ReferenceRepository, RuntimeImageProjectContent } from '../../ports/repositories';
import { developmentImagePolicies, imageLogs, imageReferences } from './tables';
import { RuntimeImageCallbackRecordSchema as callbackSchema } from '../../domain/records';

export function referenceRepository(db: Executor): ReferenceRepository {
  return {
    scan: async (after, limit) => (await db.select().from(imageReferences).where(after ? gt(imageReferences.id, after) : undefined).orderBy(asc(imageReferences.id)).limit(limit)).map((row) => row.payload),
    get: async (versionId, ownerType, ownerId) => (await db.select().from(imageReferences).where(and(eq(imageReferences.versionId, versionId), eq(imageReferences.ownerType, ownerType), eq(imageReferences.ownerId, ownerId))))[0]?.payload,
    insert: async (v) => { await db.insert(imageReferences).values({ id: v.id, versionId: v.versionId, projectId: v.projectId, ownerType: v.ownerType, ownerId: v.ownerId, payload: v }); },
    update: async (v) => { await db.update(imageReferences).set({ payload: v }).where(eq(imageReferences.id, v.id)); },
    remove: async (id) => { await db.delete(imageReferences).where(eq(imageReferences.id, id)); },
    list: async (versionId) => (await db.select().from(imageReferences).where(eq(imageReferences.versionId, versionId)).orderBy(asc(imageReferences.id))).map((r) => r.payload),
  };
}
export function logRepository(db: Executor): LogRepository {
  return {
    append: async (buildId, chunk) => { await db.insert(imageLogs).values({ buildId, stage: chunk.stage, text: chunk.text, createdAt: new Date(chunk.createdAt) }); },
    page: async (buildId, after, limit) => (await db.select().from(imageLogs).where(and(eq(imageLogs.buildId, buildId), gt(imageLogs.sequence, after))).orderBy(asc(imageLogs.sequence)).limit(limit)).map((r) => ({ sequence: r.sequence, stage: r.stage, text: r.text, createdAt: r.createdAt.toISOString() })),
    bytes: async (buildId) => Number((await db.select({ n: sql<string>`coalesce(sum(octet_length(${imageLogs.text})), 0)` }).from(imageLogs).where(eq(imageLogs.buildId, buildId)))[0]!.n),
  };
}
export function developmentPolicyRepository(db: Executor): DevelopmentPolicyRepository {
  return {
    get: async (projectId) => (await db.select().from(developmentImagePolicies).where(eq(developmentImagePolicies.projectId, projectId)))[0]?.payload,
    save: async (v) => { await db.insert(developmentImagePolicies).values({ projectId: v.projectId, payload: v }).onConflictDoUpdate({ target: developmentImagePolicies.projectId, set: { payload: v } }); },
  };
}

const contentColumns: Readonly<Record<string, readonly string[]>> = {
  images: ['id', 'name', 'default_visible', 'enabled', 'payload'],
  revisions: ['id', 'image_id', 'revision', 'payload'],
  builds: ['id', 'image_id', 'project_id', 'actor_id', 'request_key', 'state', 'lease_until', 'payload'],
  versions: ['id', 'image_id', 'build_id', 'repository', 'digest', 'state', 'payload'],
  validations: ['id', 'version_id', 'actor_id', 'request_key', 'contract_digest', 'state', 'lease_until', 'payload'],
  references: ['id', 'version_id', 'project_id', 'owner_type', 'owner_id', 'payload'],
  build_logs: ['sequence', 'build_id', 'stage', 'text', 'created_at'],
  development_policies: ['project_id', 'payload'],
  creation_requests: ['request_scope', 'actor_id', 'request_key', 'fingerprint', 'image_id', 'revision_id'],
  project_image_policies: ['project_id', 'payload'],
  image_project_grants: ['image_id', 'project_id'],
  allocation_receipts: ['operation_id', 'project_id', 'payload'],
};
const controlColumns: Readonly<Record<string, readonly string[]>> = {
  deletion_fences: ['project_id', 'operation_id', 'generation', 'revision', 'original', 'scope_verified', 'phase_index', 'receipts'],
  deletion_entities: ['kind', 'entity_key', 'project_id'], project_admissions: ['project_id', 'sealed'],
  build_provenance: ['id', 'image_id', 'revision_id'],
  deletion_callbacks: ['id', 'kind', 'consumer_id', 'project_ids', 'original_project_ids', 'backend_pid', 'callback_pid', 'callback_started_at', 'original_process', 'input_digest', 'exit_key_hash', 'entered_at', 'exited_at', 'exit_digest', 'recovery_digest'],
};
type Content = { table: string; body: Record<string, unknown> };
const document = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const field = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined;
const directTables = new Set(['references', 'development_policies', 'project_image_policies', 'image_project_grants', 'allocation_receipts']);
const payloadOwnerTables = new Set(['references', 'development_policies', 'project_image_policies', 'validations', 'builds']);

async function fullRuntimeContent(db: Executor): Promise<Content[]> {
  const found = await db.execute<{ table_name: string; column_name: string }>(sql`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='runtime_environment'`);
  const hasControls = found.some((row) => row.table_name in controlColumns), expected = { ...contentColumns, ...(hasControls ? controlColumns : {}) };
  if (found.some((row) => !expected[row.table_name]?.includes(row.column_name)) || Object.entries(expected).some(([name, columns]) => columns.some((column) => !found.some((row) => row.table_name === name && row.column_name === column)))) throw precondition('运行镜像存在未知或缺失的表／列，不能证明项目内容完整');
  // One statement gives every table the same MVCC snapshot; no catalog/history limit is reused.
  // Permanent fences/admission identities are minimal tombstones; original callback journals remain project content.
  const queries = [...Object.keys(contentColumns), ...(hasControls ? ['deletion_callbacks', 'build_provenance'] : [])].map((name) => sql`SELECT ${name}::text AS "table",to_jsonb(content) AS body FROM ${sql.identifier('runtime_environment')}.${sql.identifier(name)} AS content`);
  return [...await db.execute<Content>(sql.join(queries, sql` UNION ALL `))];
}
function projectOwners(row: Content): string[] {
  if (row.table === 'deletion_callbacks') return Array.isArray(row.body.project_ids) ? [...new Set(row.body.project_ids.map((id) => String(id)))].sort() : [];
  const payload = document(row.body.payload);
  return [...new Set([
    ...(directTables.has(row.table) || row.table === 'builds' ? [field(row.body.project_id)] : []),
    ...(row.table === 'creation_requests' && row.body.request_scope !== 'platform' ? [field(row.body.request_scope)] : []),
    ...(payloadOwnerTables.has(row.table) ? [field(payload.projectId)] : []),
    ...(row.table === 'builds' ? [field(document(payload.resourcePlan).projectId)] : []),
  ].filter((id): id is string => id !== undefined))].sort();
}
export function runtimeImageContentRowKey(row: Content): string {
  if (row.table === 'creation_requests') return jsonHash([row.body.request_scope, row.body.actor_id, row.body.request_key]);
  if (row.table === 'image_project_grants') return jsonHash([row.body.image_id, row.body.project_id]);
  return String(row.body.id ?? row.body.operation_id ?? row.body.sequence ?? row.body.project_id);
}
const rowKey = runtimeImageContentRowKey;
export function runtimeImageCallbackContent(body: Record<string, unknown>) {
  return callbackSchema.safeParse({ id: body.id, kind: body.kind, consumerId: body.consumer_id, projectIds: body.project_ids, originalProjectIds: body.original_project_ids, backendPid: body.backend_pid, callbackPid: body.callback_pid,
    callbackStartedAt: body.callback_started_at, process: body.original_process, inputDigest: body.input_digest, exitKeyDigest: body.exit_key_hash, identity: jsonHash(body), exited: body.exited_at !== null,
    ...(body.exit_digest ? { exitDigest: body.exit_digest } : {}), ...(body.recovery_digest ? { recoveryDigest: body.recovery_digest } : {}) });
}
function contentConsumer(row: Content): RuntimeImageProjectContent['consumers'][number] {
  const payload = document(row.body.payload), resourceId = field(payload.resourceId), podUid = field(payload.podUid);
  return { kind: row.table === 'builds' ? 'build' : 'validation', id: String(row.body.id), state: String(row.body.state), identity: jsonHash(row.body),
    ...(resourceId ? { resourceId } : {}), ...(podUid ? { podUid } : {}), ...(typeof payload.executionEpoch === 'number' ? { executionEpoch: payload.executionEpoch } : {}),
    ...(payload.resourcePlan !== undefined ? { planIdentity: jsonHash(payload.resourcePlan) } : {}) };
}

function contentIdentityConflict(row: Content): boolean {
  const payload = document(row.body.payload);
  if (Object.entries({ id: 'id', imageId: 'image_id', versionId: 'version_id' }).some(([property, column]) => row.body[column] !== undefined && payload[property] !== undefined && payload[property] !== row.body[column])) return true;
  return ['revisions', 'builds'].includes(row.table) && ['sourceProjectId', 'initializerProjectId'].some((key) => payload[key] !== undefined && !ProjectIdSchema.safeParse(payload[key]).success);
}

function incompleteValidationOrigins(all: Content[], projectId: string): RuntimeImageProjectContent['inventory']['blockers'] {
  const byValidation = new Map<string, Content[]>();
  for (const reference of all) if (reference.table === 'references' && reference.body.owner_type === 'validation') {
    const id = String(reference.body.owner_id), values = byValidation.get(id) ?? []; values.push(reference); byValidation.set(id, values);
  }
  return all.filter((row) => row.table === 'validations' && projectOwners(row).includes(projectId) && ['queued', 'running', 'cancelling'].includes(String(row.body.state))).flatMap((row) => {
    const references = byValidation.get(String(row.body.id)) ?? [];
    const reference = references[0], snapshot = RuntimeImageExecutionSnapshotSchema.safeParse(document(reference?.body.payload).snapshot);
    if (reference && references.length === 1 && reference.body.version_id === row.body.version_id && projectOwners(reference).length === 1 && projectOwners(reference)[0] === projectId
      && snapshot.success && snapshot.data.validationId === row.body.id && snapshot.data.versionId === row.body.version_id) return [];
    return [{ participant: 'runtime-environment' as const, code: 'runtime-image-validation-origin-missing', message: '在途验证缺少唯一、同项目且绑定原版本的执行快照，保留原材料核对实际消费者', resourceId: String(row.body.id) }];
  });
}

export async function runtimeImageProjectContent(db: Executor, rawProjectId: string): Promise<RuntimeImageProjectContent> {
  const projectId = ProjectIdSchema.parse(rawProjectId), all = await fullRuntimeContent(db);
  const blockers: RuntimeImageProjectContent['inventory']['blockers'] = [], owned: Content[] = [], invalid = new Set<string>();
  const callbacks: RuntimeImageProjectContent['callbacks'][number][] = [];
  for (const row of all) {
    if (row.table === 'deletion_callbacks') {
      const parsed = runtimeImageCallbackContent(row.body);
      if (!parsed.success) {
        blockers.push({ participant: 'runtime-environment', code: 'runtime-image-callback-origin-invalid', message: '原运行镜像回调的项目、原进程或退出事实缺失／冲突', resourceId: rowKey(row) });
      } else if (parsed.data.projectIds.includes(projectId)) { callbacks.push(parsed.data); owned.push(row); }
      continue;
    }
    const owners = projectOwners(row), requiresOwner = directTables.has(row.table) || row.table === 'validations' || row.table === 'creation_requests' && row.body.request_scope !== 'platform';
    const conflicting = owners.length > 1 || owners.some((id) => !ProjectIdSchema.safeParse(id).success) || requiresOwner && !owners.length || contentIdentityConflict(row);
    if (conflicting) { invalid.add(row.table + ':' + rowKey(row)); blockers.push({ participant: 'runtime-environment', code: 'runtime-image-owner-conflict', message: '运行镜像内容缺少原项目归属或列与文档归属冲突', resourceId: rowKey(row) }); }
    if (!conflicting && owners.length === 1 && owners[0] === projectId) owned.push(row);
  }
  const dependencies = all.filter((row) => row.table === 'revisions').flatMap((row) => {
    const payload = document(row.body.payload);
    return (['source', 'initializer'] as const).filter((kind) => payload[kind + 'ProjectId'] === projectId).map((kind) => ({ kind, revisionId: String(row.body.id), imageId: String(row.body.image_id) }));
  }).sort((a, b) => jsonHash(a).localeCompare(jsonHash(b)));
  const sourceRevisionIds = new Set(dependencies.map((dependency) => dependency.revisionId));
  const sourceBuilds = all.filter((row) => row.table === 'builds' && (document(row.body.payload).sourceProjectId === projectId || sourceRevisionIds.has(String(document(row.body.payload).revisionId))));
  const ownBuildIds = new Set(owned.filter((row) => row.table === 'builds').map((row) => String(row.body.id))), foreign: RuntimeImageProjectContent['inventory']['references'] = [];
  for (const row of sourceBuilds) {
    if (invalid.has(row.table + ':' + rowKey(row)) || ownBuildIds.has(String(row.body.id))) continue;
    const owners = projectOwners(row);
    if (owners.length && owners[0] !== projectId) { foreign.push({ kind: 'runtime-image-foreign-build-content', id: String(row.body.id), projectId: ProjectIdSchema.parse(owners[0]), description: '原来源仍被其他项目的构建内容使用，不能清理其他项目记录' }); continue; }
    owned.push(row); ownBuildIds.add(String(row.body.id));
  }
  owned.push(...all.filter((row) => row.table === 'build_logs' && ownBuildIds.has(String(row.body.build_id))));
  const consumers = all.filter((row) => row.table === 'validations' && projectOwners(row).includes(projectId) || row.table === 'builds' && (ownBuildIds.has(String(row.body.id)) || document(row.body.payload).sourceProjectId === projectId || sourceRevisionIds.has(String(document(row.body.payload).revisionId)))).map(contentConsumer).sort((a, b) => a.id.localeCompare(b.id));
  const provenance = new Map(all.filter((row) => row.table === 'build_provenance').map((row) => [String(row.body.id), row.body]));
  const references = [...foreign, ...all.filter((row) => {
    if (row.table !== 'versions' || !ownBuildIds.has(String(row.body.build_id))) return false;
    const minimum = provenance.get(String(row.body.build_id));
    return !minimum || minimum.image_id !== row.body.image_id || minimum.revision_id !== document(row.body.payload).revisionId;
  }).map((row) => ({ kind: 'platform-image-provenance', id: String(row.body.id), description: '平台目录中的不可变版本仍依赖原项目构建记录；保留定义，需先移交最小构建沿革' }))].sort((a, b) => a.id.localeCompare(b.id));
  blockers.push(...incompleteValidationOrigins(all, projectId));
  blockers.sort((a, b) => (a.code + ':' + a.resourceId).localeCompare(b.code + ':' + b.resourceId));
  const rows = owned.map((row) => ({ table: row.table, key: rowKey(row), identity: jsonHash(row.body) })).sort((a, b) => (a.table + ':' + a.key).localeCompare(b.table + ':' + b.key));
  callbacks.sort((a, b) => a.id.localeCompare(b.id));
  const resources: RuntimeImageProjectContent['inventory']['resources'] = [...Object.keys(contentColumns), 'deletion_callbacks'].flatMap((table) => {
    const values = rows.filter((row) => row.table === table);
    return values.length ? [{ kind: 'runtime-image:' + table, id: table, scope: 'metadata' as const, identity: jsonHash(values), sourceIdentity: jsonHash({ projectId, table }), count: values.length }] : [];
  });
  for (const consumer of consumers) {
    const { state: _state, identity: _contentHash, ...original } = consumer, identity = jsonHash({ projectId, ...original });
    resources.push({ kind: 'runtime-image:' + consumer.kind, id: consumer.id, scope: 'physical', identity, sourceIdentity: identity, count: 1 });
  }
  resources.sort((a, b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
  const artifacts: NonNullable<RuntimeImageProjectContent['artifacts']>[number][] = [];
  for(const row of all) {
    if(row.table==='builds'&&ownBuildIds.has(String(row.body.id))) {
      const payload=document(row.body.payload),plan=document(payload.resourcePlan),repository=field(plan.repository);
      if(repository)artifacts.push({kind:'build',id:String(row.body.id),repository,projectOwned:projectOwners(row).length===1&&projectOwners(row)[0]===projectId&&plan.projectId===projectId});
    }
    if(row.table==='versions') {
      const repository=field(row.body.repository),digest=field(row.body.digest);
      // Versions are platform catalog content. Project build/credential/log
      // records may be removed after minimal provenance has been transferred.
      if(repository&&digest)artifacts.push({kind:'version',id:String(row.body.id),repository,digest,projectOwned:false});
    }
  }
  artifacts.sort((a,b)=>(a.kind+':'+a.id).localeCompare(b.kind+':'+b.id));
  const material = { participant: 'runtime-environment' as const, complete: blockers.length === 0 && references.length === 0, resources, references, blockers };
  return { inventory: ProjectDeletionInventorySchema.parse({ ...material, revision: jsonHash({ ...material, consumers, callbacks, dependencies, artifacts }) }), rows, consumers, callbacks, dependencies, artifacts };
}
