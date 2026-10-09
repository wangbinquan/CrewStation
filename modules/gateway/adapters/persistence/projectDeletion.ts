import type { AllowlistDocument, ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionTarget, ProjectId } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission, withSharedDatabaseAdmissions } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { PodIdentityRecord } from '../../domain/podIdentity';
import type { ProjectDeletionCurrentAssets } from '@crewstation/contracts';
import { gatewayDocumentRepair, gatewayOperatorRepairs, gatewayPodRepair } from './operatorRepairs';
import type { AllowlistOwnership, GatewayDeletionRepository, GatewayOriginalDirectory, GatewayProcess, GatewayProcessOwners } from '../../ports/repositories';

const CONTENT = ['pod_identities', 'routes', 'service_maintenance', 'maintenance_events', 'rate_limits', 'rate_limit_receipts'] as const;
const CONTENT_KEYS: Record<typeof CONTENT[number], readonly string[]> = { pod_identities: ['namespace', 'pod_name'], routes: ['service_id'], service_maintenance: ['service_id'], maintenance_events: ['id'], rate_limits: ['scope'], rate_limit_receipts: ['operation_id'] };
const FACTS = ['resource_identity_aliases', 'deletion_fences', 'deletion_entities', 'deletion_document_owners', 'deletion_work', 'deletion_process_stops', 'allowlists', 'operator_confirmations'] as const;
const admissionKey = (id: string) => `gateway.project-admission:${id}`;
export const gatewayAdmissionKeys = (id: ProjectId): readonly string[] => [admissionKey(id)];
const podKey = (row: Pick<PodIdentityRecord, 'podUid' | 'source' | 'developmentSource' | 'namespace' | 'podName'>) => row.podUid ?? row.source?.podUid ?? row.developmentSource?.podUid ?? `legacy:${row.namespace}/${row.podName}`;
const value = <T>(body: unknown): T => (typeof body === 'string' ? JSON.parse(body) : body) as T;
async function registered(db: Executor) {
  const rows = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='gateway' AND table_type='BASE TABLE'`);
  if (rows.some((row) => !([...CONTENT, ...FACTS] as readonly string[]).includes(row.table_name))) throw precondition('网关存在未登记的内容表');
}
async function entityOwner(db: Executor, kind: string, key: string): Promise<ProjectId | undefined> {
  return (await db.execute<{ project_id: ProjectId }>(sql`SELECT project_id FROM gateway.deletion_entities WHERE kind=${kind} AND entity_key=${key}`))[0]?.project_id;
}
async function remember(db: Executor, kind: string, key: string, projectId: ProjectId) {
  await db.execute(sql`SELECT gateway.remember_entity(${kind},${key},${projectId})`);
}
function validateDocument(doc: AllowlistDocument) {
  if (!Number.isInteger(doc.version) || !Array.isArray(doc.entries) || !Array.isArray(doc.defaultOpen) || (doc.operationRoutes !== undefined && !Array.isArray(doc.operationRoutes)) || (doc.identityVersion === 2 && !Array.isArray(doc.operationRoutes))
    || doc.entries.some((entry) => typeof entry.caller !== 'string' || !Array.isArray(entry.operations) || entry.operations.some((key) => typeof key !== 'string'))
    || (doc.operationRoutes ?? []).some((route) => typeof route.id !== 'string') || doc.defaultOpen.some((key) => typeof key !== 'string')) throw precondition('历史放行文档结构或原操作标识无法核实');
}
function stripDocument(doc: AllowlistDocument, owners: readonly AllowlistOwnership[], projectId: ProjectId): AllowlistDocument {
  const callers = new Set(owners.filter((o) => o.projectId === projectId && o.kind === 'caller').map((o) => o.key));
  const operations = new Set(owners.filter((o) => o.projectId === projectId && o.kind === 'operation').map((o) => o.key));
  return { ...doc, entries: doc.entries.filter((e) => !callers.has(e.caller)).map((e) => ({ ...e, operations: e.operations.filter((id) => !operations.has(id)) })),
    ...(doc.operationRoutes ? { operationRoutes: doc.operationRoutes.filter((route) => !operations.has(route.id)) } : {}), defaultOpen: doc.defaultOpen.filter((id) => !operations.has(id)) };
}
function documentPart(doc: AllowlistDocument, owners: readonly AllowlistOwnership[], projectId: ProjectId) {
  const own = owners.filter((o) => o.projectId === projectId), callers = new Set(own.filter((o) => o.kind === 'caller').map((o) => o.key)), operations = new Set(own.filter((o) => o.kind === 'operation').map((o) => o.key));
  const entries = doc.entries.filter((e) => callers.has(e.caller));
  const routes = (doc.operationRoutes ?? []).filter((r) => operations.has(r.id)), open = doc.defaultOpen.filter((id) => operations.has(id));
  const links = doc.entries.filter((e) => !callers.has(e.caller)).flatMap((e) => e.operations.filter((id) => operations.has(id)).map((id) => [e.caller, id]));
  return { entries, routes, open, links, count: entries.length + routes.length + open.length + links.length };
}
async function ownersOf(db: Executor, doc: AllowlistDocument, originals: GatewayOriginalDirectory, supplied: readonly AllowlistOwnership[] = []): Promise<AllowlistOwnership[]> {
  validateDocument(doc);
  const rows = await db.execute<{ kind: 'caller' | 'operation'; entity_key: string; project_id: ProjectId }>(sql`SELECT kind,entity_key,project_id FROM gateway.deletion_document_owners WHERE version=${doc.version}`);
  const known = new Map(rows.map((r) => [`${r.kind}:${r.entity_key}`, r.project_id]));
  for (const owner of supplied) { const old = known.get(`${owner.kind}:${owner.key}`); if (old && old !== owner.projectId) throw precondition('原放行文档归属不能重写'); known.set(`${owner.kind}:${owner.key}`, owner.projectId); }
  const keys = [...doc.entries.map((e) => ({ kind: 'caller' as const, key: e.caller })), ...[...new Set([...(doc.operationRoutes ?? []).map((r) => r.id), ...doc.defaultOpen, ...doc.entries.flatMap((e) => e.operations)])].map((key) => ({ kind: 'operation' as const, key }))];
  const result: AllowlistOwnership[] = [];
  for (const entry of keys) {
    const projectId = known.get(`${entry.kind}:${entry.key}`) ?? (entry.kind === 'caller' ? (await originals.service(entry.key))?.projectId : await originals.operation(entry.key));
    if (!projectId) throw precondition('历史放行文档的原项目归属无法核实');
    result.push({ ...entry, projectId });
  }
  return result;
}
async function rememberOwners(db: Executor, version: number, owners: readonly AllowlistOwnership[]) {
  for (const owner of owners) {
    await db.execute(sql`INSERT INTO gateway.deletion_document_owners VALUES (${version},${owner.kind},${owner.key},${owner.projectId}) ON CONFLICT DO NOTHING`);
    const [row] = await db.execute<{ project_id: string }>(sql`SELECT project_id FROM gateway.deletion_document_owners WHERE version=${version} AND kind=${owner.kind} AND entity_key=${owner.key}`);
    if (row?.project_id !== owner.projectId) throw precondition('原放行文档归属不能重写');
  }
}
async function rememberCurrentOwners(db: Database, originals: GatewayOriginalDirectory) {
  const [row] = await db.execute<{ version: number; document: unknown }>(sql`SELECT version,document FROM gateway.allowlists ORDER BY version DESC LIMIT 1`);
  if (!row) return;
  const doc = value<AllowlistDocument>(row.document); if (doc.version !== row.version) throw precondition('原放行文档版本不符');
  const owners = await ownersOf(db, doc, originals);
  await db.transaction((tx) => rememberOwners(tx, row.version, owners));
}
function podRecord(body: Record<string, unknown>): PodIdentityRecord {
  return { namespace: String(body['namespace']), podName: String(body['pod_name']), ip: String(body['ip']), project: String(body['project']), service: String(body['service']), workload: body['workload'] as PodIdentityRecord['workload'], version: Number(body['version']), updatedAt: new Date(String(body['updated_at'])),
    ...(body['pod_uid'] ? { podUid: String(body['pod_uid']) } : {}), ...(body['task_id'] ? { taskId: String(body['task_id']) } : {}),
    ...(body['service_source'] ? { source: body['service_source'] as PodIdentityRecord['source'] } : {}), ...(body['development_source'] ? { developmentSource: body['development_source'] as PodIdentityRecord['developmentSource'] } : {}) };
}
async function rowOwner(db: Executor, table: typeof CONTENT[number], body: Record<string, unknown>, originals: GatewayOriginalDirectory): Promise<ProjectId | undefined> {
  const [row] = await db.execute<{ owner: ProjectId | null }>(sql`SELECT gateway.content_owner(${table},${JSON.stringify(body)}::jsonb) AS owner`);
  if (row?.owner) return row.owner;
  if (table === 'pod_identities') return body['workload'] === 'platform' ? undefined : originals.pod(podRecord(body));
  if (table === 'routes' || table === 'maintenance_events') return (await originals.service(String(body['service_id'])))?.projectId;
  return undefined;
}
function fingerprint(body: Record<string, unknown>, table: typeof CONTENT[number]) {
  if (table !== 'pod_identities') return body;
  const { version: _version, updated_at: _updated, deleted_at: _deleted, ...rest } = body;
  return { ...rest, service_source: body['service_source'] ? { ...body['service_source'] as object, ready: undefined } : null, development_source: body['development_source'] ? { ...body['development_source'] as object, ready: undefined } : null };
}
async function scan(db: Executor, target: ProjectDeletionTarget, originals: GatewayOriginalDirectory, seed = false, currentAssets?: ProjectDeletionCurrentAssets): Promise<ProjectDeletionInventory> {
  await registered(db); const resources: ProjectDeletionInventory['resources'] = [], blockers: ProjectDeletionInventory['blockers'] = [], references = new Map<string, ProjectDeletionInventory['references'][number]>();
  const retained: string[] = [];
  for (const table of CONTENT) {
    let cursor: unknown[] | undefined, count = 0, hash = jsonHash([]);
    const pageKey = sql`jsonb_build_array(${sql.join(CONTENT_KEYS[table].map((key) => sql`c.${sql.identifier(key)}`), sql`,`)})`;
    for (;;) {
      const rows = await db.execute<{ body: Record<string, unknown>; page_key: unknown[] }>(sql`SELECT to_jsonb(c) AS body,${pageKey} AS page_key FROM gateway.${sql.identifier(table)} c WHERE ${cursor ? sql`${pageKey}>${JSON.stringify(cursor)}::jsonb` : sql`true`} ORDER BY ${pageKey} LIMIT 500`);
      for (const { body } of rows) {
        const owner = await rowOwner(db, table, body, originals);
        if (!owner && table === 'pod_identities' && body['workload'] !== 'platform' && currentAssets) {
          const item = await gatewayPodRepair(db, { originals, currentAssets }, target, body);
          if (item.confirmed?.decision === 'retain') { retained.push(jsonHash(item)); continue; }
        }
        if (!owner && !(table === 'pod_identities' && body['workload'] === 'platform') && !(table === 'rate_limits' && body['scope'] === 'platform')) blockers.push({ participant: 'gateway', code: 'ownership-unknown', message: '网关历史内容的原项目身份无法核实', resourceId: jsonHash(body) });
        if (owner !== target.id) continue;
        if (seed && table === 'pod_identities') await remember(db, 'pod', podKey(podRecord(body)), owner);
        if (seed && (table === 'routes' || table === 'maintenance_events' || table === 'service_maintenance')) await remember(db, 'service', String(body['service_id']), owner);
        count += 1; hash = jsonHash({ previous: hash, body: fingerprint(body, table) });
      }
      if (rows.length < 500) break; cursor = rows.at(-1)!.page_key;
    }
    resources.push({ kind: table, id: target.id, identity: jsonHash({ count, hash }), count, scope: 'metadata' });
  }
  let after = 0, count = 0, hash = jsonHash([]);
  for (;;) {
    const rows = await db.execute<{ version: number; document: unknown }>(sql`SELECT version,document FROM gateway.allowlists WHERE version>${after} ORDER BY version LIMIT 100`);
    for (const row of rows) {
      try {
        const doc = value<AllowlistDocument>(row.document); if (doc.version !== row.version) throw precondition('原放行文档版本不符'); const owners = await ownersOf(db, doc, originals);
        if (seed) await rememberOwners(db, row.version, owners); const part = documentPart(doc, owners, target.id);
        if (part.count) { count += part.count; hash = jsonHash({ previous: hash, version: row.version, part }); }
        for (const [caller] of part.links) {
          const projectId = owners.find((o) => o.kind === 'caller' && o.key === caller)!.projectId;
          references.set(projectId, { kind: 'allowlist-incoming-caller', id: projectId, projectId, description: '本项目接口关闭后，该项目在共享放行表中的相关授权关系会移除，其他授权保留' });
        }
      }
      catch {
        let confirmed = false;
        if (currentAssets) {
          try {
            const [original] = await db.execute<{ body: Record<string, unknown> }>(sql`SELECT to_jsonb(r) AS body FROM gateway.allowlists r WHERE version=${row.version}`);
            const item = original && await gatewayDocumentRepair(db, { originals, currentAssets }, target, original.body);
            if (item?.confirmed?.decision === 'retain') { retained.push(jsonHash(item)); confirmed = true; }
          } catch { /* An unverifiable candidate remains an ordinary blocker. */ }
        }
        if (!confirmed) blockers.push({ participant: 'gateway', code: 'document-ownership-unknown', message: '历史放行文档结构或原归属无法核实', resourceId: String(row.version) });
      }
      after = row.version;
    }
    if (rows.length < 100) break;
  }
  resources.push({ kind: 'allowlist-project-parts', id: target.id, identity: jsonHash({ count, hash }), count, scope: 'metadata' });
  if (retained.length) resources.push({ kind: 'operator-retained-history', id: target.id, identity: jsonHash(retained), count: 0, scope: 'metadata' });
  const work = await db.execute<{ id: string; kind: string; backend_pid: number; pod_uid: string | null; container_id: string | null; node_uid: string | null; node_name: string | null }>(sql`SELECT id,kind,backend_pid,pod_uid,container_id,node_uid,node_name FROM gateway.deletion_work WHERE project_id=${target.id} ORDER BY id`);
  for (const row of work) resources.push({ kind: 'gateway-callback', id: row.id, identity: jsonHash(row), sourceIdentity: jsonHash(row), count: 1, scope: 'physical' });
  return { participant: 'gateway', revision: jsonHash({ resources, references: [...references.values()] }), complete: blockers.length === 0, resources, references: [...references.values()], blockers };
}
async function lock(db: Executor, context: ProjectDeletionContext) {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${admissionKey(context.target.id)},0))`);
  await db.execute(sql`INSERT INTO gateway.deletion_fences(project_id) VALUES (${context.target.id}) ON CONFLICT DO NOTHING`);
  const [row] = await db.execute<{ operation_id: string | null; generation: number; confirmed_revision: string | null; scope_verified: boolean }>(sql`SELECT operation_id,generation,confirmed_revision,scope_verified FROM gateway.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`);
  if (!row || row.operation_id && row.operation_id !== context.operationId || row.generation > context.generation) throw precondition('网关删除屏障的原操作或世代不符');
  return row;
}
async function pending(db: Executor, projectId: string) { return (await db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM gateway.deletion_work WHERE project_id=${projectId} AND state='running') AS pending`))[0]?.pending !== false; }
async function sealed(db: Executor, context: ProjectDeletionContext) {
  const row = await lock(db, context);
  if (row.operation_id !== context.operationId || row.confirmed_revision !== context.confirmed.revision || !row.scope_verified || await pending(db, context.target.id)) throw precondition('网关持久封闭或原实际回调退出尚未完成');
  await db.execute(sql`UPDATE gateway.deletion_fences SET generation=${context.generation} WHERE project_id=${context.target.id}`);
}
async function finish(db: Database, id: string, backend: number, proof?: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('crewstation.gateway_work_exit',${`${id}:1:${backend}`},true)`);
    await tx.execute(sql`UPDATE gateway.deletion_work SET state='finished',proof_digest=${proof ?? null} WHERE id=${id} AND backend_pid=${backend} AND generation=1 AND state='running'`);
  });
}
async function recoverProcess(db: Database, process: GatewayProcess, digest: string) {
  if (!process.podUid || !process.containerId || !process.nodeUid || !process.nodeName || !/^[a-f0-9]{64}$/.test(digest)) throw precondition('原网关回调容器停止证明不完整');
  await db.transaction(async (tx) => {
    await tx.execute(sql`INSERT INTO gateway.deletion_process_stops VALUES (${process.podUid},${process.containerId},${process.nodeUid},${process.nodeName},${digest}) ON CONFLICT DO NOTHING`);
    const [receipt] = await tx.execute<{ proof_digest: string }>(sql`SELECT proof_digest FROM gateway.deletion_process_stops WHERE pod_uid=${process.podUid} AND container_id=${process.containerId} AND node_uid=${process.nodeUid} AND node_name=${process.nodeName}`);
    const rows = await tx.execute<{ id: string; backend_pid: number }>(sql`SELECT id,backend_pid FROM gateway.deletion_work WHERE pod_uid=${process.podUid} AND container_id=${process.containerId} AND node_uid=${process.nodeUid} AND node_name=${process.nodeName} AND state='running' FOR UPDATE`);
    for (const row of rows) { await tx.execute(sql`SELECT set_config('crewstation.gateway_work_exit',${`${row.id}:1:${row.backend_pid}`},true)`); await tx.execute(sql`UPDATE gateway.deletion_work SET state='finished',proof_digest=${receipt!.proof_digest} WHERE id=${row.id} AND state='running'`); }
  });
}
export interface GatewayDeletionDependencies {
  currentAssets?: ProjectDeletionCurrentAssets;
  originals: GatewayOriginalDirectory;
  assertGrant?: (context: ProjectDeletionContext) => Promise<void>;
  assertAvailable?: (id: ProjectId) => Promise<void>;
  available?: (id: ProjectId) => Promise<boolean>;
  availableMany?: (ids: readonly ProjectId[]) => Promise<readonly ProjectId[]>;
  processes?: GatewayProcessOwners;
}
export function gatewayDeletionRepository(db: Database, deps: GatewayDeletionDependencies): GatewayDeletionRepository {
  const permitted = async (context: ProjectDeletionContext) => { if (!deps.assertGrant) throw precondition('正式项目删除许可尚未装配'); await deps.assertGrant(context); };
  const available = async (id: ProjectId) => !(await db.execute(sql`SELECT project_id FROM gateway.deletion_fences WHERE project_id=${id} AND operation_id IS NOT NULL`)).length
    && (deps.availableMany ? (await deps.availableMany([id])).includes(id) : await deps.available?.(id) ?? true);
  const recover = async () => deps.processes?.sweep({ stopped: (process, digest) => recoverProcess(db, process, digest), releasable: async (uid) => (await db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM gateway.deletion_work WHERE pod_uid=${uid} AND state='running') AS pending`))[0]?.pending === false });
  return {
    ...(deps.currentAssets ? { repairs: gatewayOperatorRepairs(db, { originals: deps.originals, currentAssets: deps.currentAssets }, {
      pod: async (tx, body) => body['workload'] !== 'platform' && !await rowOwner(tx, 'pod_identities', body, deps.originals),
      document: async (tx, doc) => { try { await ownersOf(tx, doc, deps.originals); return false; } catch { return true; } },
    }) } : {}),
    inspect: (target) => scan(db, target, deps.originals, false, deps.currentAssets), available, recover: async () => { await recover(); await rememberCurrentOwners(db, deps.originals); },
    callerAvailable: async (identity, version) => {
      const [row] = await db.execute<{ project_id: ProjectId }>(sql`SELECT project_id FROM gateway.deletion_document_owners WHERE version=${version} AND kind='caller' AND entity_key=${identity}`);
      const id = row?.project_id ?? (await deps.originals.service(identity))?.projectId;
      return Boolean(id && await available(id));
    },
    podAvailable: async (record) => record.workload === 'platform' || Boolean(await (async () => { const id = await entityOwner(db, 'pod', podKey(record)) ?? await deps.originals.pod(record); return id && await available(id); })()),
    rememberPod: async (record) => { if (record.workload === 'platform') return; const known = await entityOwner(db, 'pod', podKey(record)), original = await deps.originals.pod({ ...record, version: 0 }); if (known && original && known !== original) throw precondition('原 Pod 的项目归属不能替换'); const id = known ?? original; if (!id) throw precondition('原 Pod 的项目归属无法核实'); await remember(db, 'pod', podKey(record), id); },
    documentOwners: (doc, supplied) => ownersOf(db, doc, deps.originals, supplied),
    view: async (doc) => {
      const owners = await ownersOf(db, doc, deps.originals), ids = [...new Set(owners.map((owner) => owner.projectId))]; let result = doc;
      const active = deps.availableMany ? new Set(await deps.availableMany(ids)) : new Set((await Promise.all(ids.map(async (id) => await available(id) ? id : undefined))).filter((id) => id !== undefined));
      const closed = new Set((await db.execute<{ project_id: ProjectId }>(sql`SELECT project_id FROM gateway.deletion_fences WHERE operation_id IS NOT NULL AND project_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`)).map((r) => r.project_id));
      for (const id of ids) if (closed.has(id) || !active.has(id)) result = stripDocument(result, owners, id);
      return result;
    },
    withEffects: (service, kind, work) => withSharedDatabaseAdmissions(db, gatewayAdmissionKeys(service.projectId), async (guard) => {
      if (!await available(service.projectId)) throw precondition('项目网关准入已关闭'); await deps.assertAvailable?.(service.projectId);
      await remember(db, 'service', service.serviceId, service.projectId);
      if (deps.assertGrant && !deps.processes) throw precondition('原网关回调进程来源尚未装配');
      const process = await deps.processes?.protectCurrent(), backend = Number((await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]?.pid), id = newResourceId();
      await db.transaction(async (tx) => { await tx.execute(sql`INSERT INTO gateway.deletion_work VALUES (${id},${service.projectId},${kind},${backend},1,'running',${process?.podUid ?? null},${process?.containerId ?? null},${process?.nodeUid ?? null},${process?.nodeName ?? null},NULL)`); });
      try { return await work(); } finally { await finish(db, id, backend); }
    }),
    seal: async (context) => {
      await recover(); return withExclusiveDatabaseAdmission(db, admissionKey(context.target.id), async (tx) => {
        const row = await lock(tx, context); await permitted(context);
        const renewed = Boolean(row.operation_id && !row.scope_verified && row.generation < context.generation && row.confirmed_revision !== context.confirmed.revision);
        if (row.operation_id && row.confirmed_revision !== context.confirmed.revision && !renewed) throw precondition('网关确认摘要不能替换');
        if (row.operation_id && !renewed) return !row.scope_verified ? 'changed' : await pending(tx, context.target.id) ? 'waiting' : 'sealed';
        await tx.execute(sql`UPDATE gateway.deletion_fences SET operation_id=${context.operationId},generation=${context.generation},confirmed_revision=${context.confirmed.revision},scope_verified=false WHERE project_id=${context.target.id}`);
        const verified = await tx.transaction(async (scope) => {
          const current = await scan(scope, context.target, deps.originals, false, deps.currentAssets);
          if (!current.complete || current.revision !== context.confirmed.revision) return false;
          await scan(scope, context.target, deps.originals, true, deps.currentAssets); return true;
        }).catch(() => false);
        if (!verified) return 'changed';
        await tx.execute(sql`UPDATE gateway.deletion_fences SET scope_verified=true WHERE project_id=${context.target.id}`);
        return await pending(tx, context.target.id) ? 'waiting' : 'sealed';
      });
    },
    assertSealed: (context) => db.transaction(async (tx) => { await sealed(tx, context); await permitted(context); }),
    purge: (context) => db.transaction(async (tx) => {
      await sealed(tx, context); await permitted(context); await registered(tx);
      await tx.execute(sql`SELECT set_config('crewstation.gateway_deletion',${context.operationId},true)`);
      for (const table of CONTENT) await tx.execute(sql`DELETE FROM gateway.${sql.identifier(table)} c WHERE gateway.content_owner(${table},to_jsonb(c))=${context.target.id}`);
      await tx.execute(sql`UPDATE gateway.allowlists SET document=gateway.strip_document(document,version,ARRAY[${context.target.id}]) WHERE document IS DISTINCT FROM gateway.strip_document(document,version,ARRAY[${context.target.id}])`);
      await tx.execute(sql`DELETE FROM gateway.deletion_work WHERE project_id=${context.target.id}`);
      const report = await scan(tx, context.target, deps.originals, false, deps.currentAssets);
      if (!report.complete || report.resources.some((r) => r.count !== 0)) throw precondition('网关项目内容清理没有归零或存在未知内容');
    }),
  };
}

export async function saveGatewayDocument(db: Database, repository: GatewayDeletionRepository, doc: AllowlistDocument, supplied?: readonly AllowlistOwnership[]) {
  const owners = await repository.documentOwners(doc, supplied);
  await db.transaction(async (tx) => { await rememberOwners(tx, doc.version, owners); await tx.execute(sql`INSERT INTO gateway.allowlists(version,document,generated_at) VALUES (${doc.version},${JSON.stringify(doc)}::jsonb,${doc.generatedAt}::timestamptz)`); });
}
