import type { ProjectDeletionBlocker, ProjectDeletionInventory, ProjectDeletionTarget, ServiceId } from '@crewstation/contracts';
import { ProjectDeletionInventorySchema, ProjectDeletionTargetSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { ReleaseContentDirectory } from '../../ports/repositories';
import { ReleaseCallbackRecordSchema, releaseCallbackIdentity } from '../../domain/release';
import type { ReleaseCallbackRecord, ReleaseDeletionContent } from '../../domain/release';
import type { ServiceResolver } from '../../ports/platform';

const columns: Readonly<Record<string, readonly string[]>> = {
  releases: ['id', 'service_id', 'project_id', 'tag', 'commit_sha', 'branch', 'status', 'target_slot', 'image', 'manifest', 'config_version', 'pipeline', 'message', 'created_by', 'created_at', 'updated_at', 'legacy_manifest', 'identity_provenance', 'legacy_resource_id'],
  service_slots: ['service_id', 'active', 'blue', 'green', 'updated_at'],
  traffic_switches: ['id', 'service_id', 'from_slot', 'to_slot', 'release_id', 'previous_release_id', 'actor_user_id', 'reason', 'created_at'],
  replica_overrides: ['service_id', 'physical', 'replicas'],
  slot_maintenance: ['id', 'service_id', 'state', 'body', 'legacy_body', 'identity_provenance'],
  slot_events: ['id', 'service_id', 'kind', 'release_id', 'tag', 'reason', 'actor_user_id', 'deadline', 'at'],
  offline_policy: ['id', 'rollback_retention_hours', 'idle_offline_days', 'reminder_lead_hours', 'revision', 'updated_by', 'updated_at'],
  execution_handoffs: ['id', 'request_key', 'service_id', 'stage', 'body', 'revision', 'owner', 'lease_until', 'updated_at'],
  resource_identity_aliases: ['kind', 'key', 'id'],
  deletion_fences: ['project_id','operation_id','generation','revision','original','scope_verified','phase_index','receipts'],
  project_admissions: ['project_id','sealed'],
  deletion_entities: ['kind','entity_key','project_id'],
  deletion_callbacks: ['id','kind','consumer_id','project_id','service_id','backend_pid','original_process','input_digest','exit_key_hash','entered_at','exited_at','exit_digest','recovery_digest'],
};
const contentTables = Object.keys(columns).filter((name) => !['offline_policy', 'resource_identity_aliases','deletion_fences','project_admissions','deletion_entities'].includes(name));
type Row = { table: string; body: Record<string, unknown>; key: string; owners: Set<string>; releases: Set<string>; services: Set<string> };
const blocker = (code: string, message: string): ProjectDeletionBlocker => ({ participant: 'release', code, message });
const string = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined;
const object = (value: unknown): Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const releaseContentRowKey = (table: string, body: Record<string, unknown>) => table === 'replica_overrides' ? JSON.stringify([body.service_id, body.physical]) : string(body.id) ?? string(body.service_id) ?? '';

export function releaseCallbackContent(body: Record<string, unknown>): ReleaseCallbackRecord | undefined {
  const parsed = ReleaseCallbackRecordSchema.safeParse({
    id: body.id, kind: body.kind, consumerId: body.consumer_id, projectId: body.project_id, serviceId: body.service_id,
    backendPid: body.backend_pid, process: body.original_process, inputDigest: body.input_digest, exitKeyDigest: body.exit_key_hash,
    exited: body.exited_at !== null, ...(body.exit_digest ? { exitDigest: body.exit_digest } : {}), ...(body.recovery_digest ? { recoveryDigest: body.recovery_digest } : {}),
  });
  if (!parsed.success || parsed.data.exited && parsed.data.exitDigest !== releaseCallbackIdentity(parsed.data, parsed.data.recoveryDigest)) return undefined;
  return parsed.data;
}

/** Explicit ownership fields in current and historical documents; arbitrary payload strings are not aliases. */
function documentReferences(raw: unknown, projects: Set<string>, services: Set<string>, releases: Set<string>): void {
  if (Array.isArray(raw)) { for (const value of raw) documentReferences(value, projects, services, releases); return; }
  for (const [key, value] of Object.entries(object(raw))) {
    const id = string(value);
    if (id && ['projectId', 'project_id'].includes(key)) projects.add(id);
    if (id && ['serviceId', 'service_id'].includes(key)) services.add(id);
    if (id && ['releaseId', 'release_id', 'targetReleaseId', 'expectedActiveReleaseId', 'previousReleaseId'].includes(key)) releases.add(id);
    if (value && typeof value === 'object') documentReferences(value, projects, services, releases);
  }
}
function consumerBirth(row: Row, physical?: string): string {
  if (row.table === 'service_slots') return jsonHash({ serviceId: row.body.service_id, physical });
  if (row.table === 'releases') return jsonHash(Object.fromEntries(['id','project_id','service_id','legacy_resource_id','tag','commit_sha','branch','created_by','created_at'].map((key) => [key,row.body[key]])));
  const body = object(row.body.body);
  if (row.table === 'slot_maintenance') return jsonHash({ id:row.body.id,serviceId:row.body.service_id,operation:body.operation ?? null,legacy:row.body.legacy_body ?? null });
  return jsonHash({ id:row.body.id,serviceId:row.body.service_id,requestKey:row.body.request_key,
    original:Object.fromEntries(['id','serviceId','projectId','requestKey','targetReleaseId','expectedActiveReleaseId','targetSlot','actorUserId','reason','createdAt'].map((key)=>[key,body[key] ?? null])) });
}
function report(rows: readonly Row[], target: ProjectDeletionTarget, blockers: ProjectDeletionBlocker[], references: ProjectDeletionInventory['references'], aliases = new Map<string, string>()): ReleaseDeletionContent {
  const own = rows.filter((row) => row.owners.size === 1 && row.owners.has(target.id));
  const content = own.map((row) => ({ table: row.table, key: row.key, identity: jsonHash(row.body) }))
    .sort((a, b) => (a.table + ':' + a.key).localeCompare(b.table + ':' + b.key));
  const consumers: ReleaseDeletionContent['consumers'][number][] = [], callbacks: ReleaseCallbackRecord[] = [];
  for (const row of own) {
    const serviceId = [...row.services][0]; if (!serviceId) continue;
    if (row.table === 'deletion_callbacks') {
      const callback = releaseCallbackContent(row.body);
      if (!callback) blockers.push(blocker('release-callback-source-invalid','原发布回调的出生或退出来源不完整'));
      else { callbacks.push(callback); consumers.push({ kind:'callback',id:callback.id,serviceId:callback.serviceId,identity:releaseCallbackIdentity(callback),state:callback.exited?'exited':'running',aliases:[callback.id] }); }
    }
    if (row.table === 'releases') {
      const id = string(row.body.id)!, oldIds = [...aliases].filter(([key, value]) => value === id && JSON.parse(key)[0] === 'release' && JSON.parse(key).length === 2).map(([key]) => String(JSON.parse(key)[1]));
      consumers.push({ kind: 'release', id, serviceId, identity: consumerBirth(row), state: string(row.body.status) ?? 'unknown', aliases: [...new Set([id, string(row.body.legacy_resource_id), ...oldIds].filter((value): value is string => !!value))].sort() });
    }
    if (row.table === 'execution_handoffs' || row.table === 'slot_maintenance') consumers.push({ kind: row.table === 'execution_handoffs' ? 'handoff' : 'maintenance', id: string(row.body.id)!, serviceId, identity: consumerBirth(row), state: string(row.body.stage) ?? string(row.body.state) ?? 'unknown', aliases: [string(row.body.id)!] });
    if (row.table === 'service_slots') for (const physical of ['blue', 'green']) {
      const value = object(row.body[physical]);
      consumers.push({ kind: 'slot', id: JSON.stringify([serviceId, physical]), serviceId, identity: consumerBirth(row,physical), state: string(value.state) ?? 'unknown', aliases: [physical] });
    }
  }
  consumers.sort((a, b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
  const resources = contentTables.flatMap((kind) => {
    const entries = content.filter((entry) => entry.table === kind);
    return entries.length ? [{ kind, id: kind, identity: jsonHash(entries), sourceIdentity: jsonHash({ kind, projectId: target.id }), scope: 'metadata' as const, count: entries.length }] : [];
  });
  const ownIds = new Set([target.id as string, ...(target.serviceId ? [target.serviceId] : []), ...own.filter((row) => row.table === 'releases').map((row) => String(row.body.id)), ...own.flatMap((row) => [...row.services])]);
  const bindings = [...aliases].filter(([, id]) => ownIds.has(id)).sort(([a], [b]) => a.localeCompare(b));
  if (bindings.length) resources.push({ kind: 'release-identity-scope', id: target.id, identity: jsonHash(bindings), sourceIdentity: jsonHash({ projectId: target.id, kind: 'release-identity-scope' }), scope: 'metadata', count: 0 });
  const material = { participant: 'release' as const, complete: !blockers.length && !references.length, resources, references, blockers };
  const artifacts=own.filter(row=>row.table==='releases'&&string(row.body.image)).map(row=>({releaseId:String(row.body.id),reference:String(row.body.image)})).sort((a,b)=>a.releaseId.localeCompare(b.releaseId));
  const buildInputs=own.filter(row=>row.table==='releases').map(row=>({releaseId:String(row.body.id),serviceId:String(row.body.service_id),commit:String(row.body.commit_sha)})).sort((a,b)=>a.releaseId.localeCompare(b.releaseId));
  return { inventory: ProjectDeletionInventorySchema.parse({ ...material, revision: jsonHash({ ...material, artifacts, buildInputs }) }), rows: content, consumers, artifacts, buildInputs, callbacks: callbacks.sort((a,b)=>a.id.localeCompare(b.id)),
    identityLinks: bindings.map(([key, id]) => { const [kind, ...keys] = JSON.parse(key) as string[]; return { kind: kind!, keys, id }; }) };
}
async function schemaComplete(db: Executor): Promise<boolean> {
  const actual = await db.execute<{ table_name: string; column_name: string }>(sql`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='release'`);
  return !actual.some((entry) => !columns[entry.table_name]?.includes(entry.column_name))
    && Object.entries(columns).every(([name, expected]) => expected.every((column) => actual.some((entry) => entry.table_name === name && entry.column_name === column)));
}

async function identityScope(input: { identities?: ReleaseContentDirectory }, target: ProjectDeletionTarget, rawRows: readonly { table: string; body: Record<string, unknown> }[], blocked: (code: string, message: string) => void) {
  const aliases = new Map<string, string>();
  const bindAlias = (kind: string, key: string | readonly string[], id: string) => {
    const encoded = JSON.stringify([kind, ...(typeof key === 'string' ? [key] : key)]), previous = aliases.get(encoded);
    if (previous && previous !== id) { blocked('release-identity-conflict', '发布旧标识不能覆盖已保留的原身份'); return; }
    aliases.set(encoded, id);
  };
  for (const row of rawRows.filter((entry) => entry.table === 'resource_identity_aliases')) {
    let keys: unknown;
    try { keys = JSON.parse(String(row.body.key)); } catch { blocked('release-alias-invalid', '发布旧标识目录不可解析'); continue; }
    if (!Array.isArray(keys) || !keys.length || keys.some((key) => !string(key)) || !ResourceIdSchema.safeParse(row.body.id).success || !string(row.body.kind)) { blocked('release-alias-invalid', '发布旧标识目录缺少原身份'); continue; }
    bindAlias(String(row.body.kind), keys as string[], String(row.body.id));
  }
  const resolved = new Map<string, string | undefined>();
  const normalize = async (kind: string, key: string): Promise<string | undefined> => {
    const encoded = JSON.stringify([kind, key]); if (resolved.has(encoded)) return resolved.get(encoded);
    const local = aliases.get(encoded);
    const canonical = ResourceIdSchema.safeParse(key).success ? key : undefined;
    // UUIDs remain the normal API boundary; only legacy keys need the external directory.
    const external = canonical ? undefined : await input.identities?.resolve(kind, [key]);
    const candidates = new Set([local, external, canonical].filter((id): id is string => !!id));
    const result = [...candidates][0];
    if (candidates.size > 1 || result && !ResourceIdSchema.safeParse(result).success) { blocked('release-identity-conflict', '发布原标识的归属互相冲突'); resolved.set(encoded, undefined); return undefined; }
    resolved.set(encoded, result); return result;
  };
  // Capture the target's aliases even when provisioning never produced a release record.
  for (const [kind, id] of [['project', target.id], ...(target.serviceId ? [['service', target.serviceId]] : [])]) {
    for (const keys of await input.identities?.aliases(kind!, id!) ?? []) {
      if (!keys.length || keys.some((key) => !string(key))) { blocked('release-alias-invalid', '发布目标旧标识目录缺少完整身份元组'); continue; }
      const resolved = await input.identities?.resolve(kind!, keys);
      if (resolved !== id) { blocked('release-identity-conflict', '发布目标的旧项目或服务标识已改变归属'); continue; }
      bindAlias(kind!, keys, id!);
    }
  }
  return { aliases, normalize, bindAlias };
}

export async function releaseContentOver(tx: Executor, input: { services: ServiceResolver; identities?: ReleaseContentDirectory }, raw: ProjectDeletionTarget): Promise<ReleaseDeletionContent> {
  const target = ProjectDeletionTargetSchema.parse(raw);
  if (!await schemaComplete(tx)) return report([], target, [blocker('release-schema-incomplete', '发布存在未知或缺失的表／列，无法确认完整内容范围')], []);
  const statements = Object.keys(columns).map((name) => sql`SELECT ${name}::text AS table,to_jsonb(content) AS body FROM ${sql.identifier('release')}.${sql.identifier(name)} AS content`);
  const rawRows = await tx.execute<{ table: string; body: Record<string, unknown> }>(sql.join(statements, sql` UNION ALL `));
  const blockers: ProjectDeletionBlocker[] = [], references: ProjectDeletionInventory['references'] = [];
  const blocked = (code: string, message: string) => { if (!blockers.some((entry) => entry.code === code)) blockers.push(blocker(code, message)); };
  const { aliases, normalize, bindAlias } = await identityScope(input, target, rawRows, blocked);
  const rows: Row[] = rawRows.filter((entry) => contentTables.includes(entry.table)).map((entry) => ({ ...entry, key: releaseContentRowKey(entry.table, entry.body), owners: new Set<string>(), releases: new Set<string>(), services: new Set<string>() }));
  const serviceOwners = new Map<string, Set<string>>(), releaseOwners = new Map<string, Set<string>>(), resolvedServices = new Map<string, string | undefined>();
  const bind = (index: Map<string, Set<string>>, key: string, owners: Iterable<string>) => {
    const values = index.get(key) ?? new Set<string>(); for (const owner of owners) values.add(owner); index.set(key, values);
  };
  if (target.serviceId) bind(serviceOwners, target.serviceId, [target.id]);
  for (const row of rows) {
    if (!row.key) blocked('release-record-invalid', '发布内容记录缺少稳定主键');
    const projects = new Set<string>(); documentReferences(row.body, projects, row.services, row.releases);
    const project = string(row.body.project_id); if (project) projects.add(project);
    const service = string(row.body.service_id); if (service) row.services.add(service);
    const oldServices = [...row.services]; row.services.clear();
    for (const key of oldServices) {
      const id = await normalize('service', key);
      if (!id) { blocked('release-service-source-missing', '发布记录含无法核对原身份的服务标识'); continue; }
      row.services.add(id);
      if (!resolvedServices.has(id)) resolvedServices.set(id, (await input.services.resolveServiceById(id as ServiceId))?.projectId);
      const owner = resolvedServices.get(id);
      if (owner && !ResourceIdSchema.safeParse(owner).success) blocked('release-service-source-missing', '服务来源缺少有效的原项目 UUID');
      else if (owner) bind(serviceOwners, id, [owner]);
    }
    for (const key of projects) {
      const owner = await normalize('project', key);
      if (owner) row.owners.add(owner); else blocked('release-project-source-missing', '发布记录含无法核对原身份的项目标识');
    }
    if (row.table === 'deletion_callbacks') {
      const callback = releaseCallbackContent(row.body);
      if (!callback) blocked('release-callback-source-invalid', '原发布回调出生或实际退出记录不完整');
      else bind(serviceOwners, callback.serviceId, [callback.projectId]);
    }
    if (row.table === 'releases') {
      const id = string(row.body.id)!;
      if (!string(row.body.project_id) || !string(row.body.service_id)) blocked('release-record-invalid', '原发布缺少项目或服务关联，不能用当前查询补造历史归属');
      if (!ResourceIdSchema.safeParse(id).success) blocked('release-record-invalid', '发布记录缺少原 UUID');
      else if (await normalize('release', id) !== id) blocked('release-identity-conflict', '发布原 UUID 与旧标识目录冲突');
      const legacy = string(row.body.legacy_resource_id);
      if (legacy) {
        const key = JSON.stringify(['release', legacy]), previous = aliases.get(key);
        if (previous && previous !== id) blocked('release-identity-conflict', '发布旧 ID 在保留记录和目录间冲突');
        else bindAlias('release', legacy, id);
      }
      for (const svc of row.services) bind(serviceOwners, svc, row.owners);
      bind(releaseOwners, id, row.owners);
    }
  }
  for (const row of rows) {
    const ids = [...row.releases]; row.releases.clear();
    for (const key of ids) {
      const id = await normalize('release', key);
      if (id && releaseOwners.has(id)) row.releases.add(id); else blocked('release-reference-source-missing', '发布槽、切流、交接或旧快照引用的原发布记录缺失');
    }
  }
  for (const row of rows) {
    const primary = new Set(row.owners);
    for (const service of row.services) for (const owner of serviceOwners.get(service) ?? []) primary.add(owner);
    row.owners = primary;
    const linked = new Set<string>(); for (const id of row.releases) for (const owner of releaseOwners.get(id) ?? []) linked.add(owner);
    if (!primary.size) for (const owner of linked) row.owners.add(owner);
    if ([...linked].some((owner) => !row.owners.has(owner))) {
      blocked('release-cross-project-reference', '发布内容和引用的原版本属于不同项目，不能代替其他项目删除');
      if (row.owners.has(target.id) || linked.has(target.id)) references.push({ kind: row.table, id: row.key, projectId: [...primary].find((id) => id !== target.id) as ProjectDeletionInventory['references'][number]['projectId'], description: '其他项目仍引用原发布，需原所有者处理引用' });
    }
    if (!row.owners.size) blocked('release-orphan-content', '发布存在归属不明的历史内容，不能把工作台空列表当成已清理');
    if (row.owners.size > 1) blocked('release-ownership-conflict', '发布记录、服务和历史快照的原项目归属冲突');
  }
  for (const row of rawRows.filter((entry) => entry.table === 'offline_policy')) if (row.body.id !== 'platform') blocked('release-global-policy-invalid', '发布全局策略有未知作用域，不能随项目清除');
  return report(rows, target, blockers, references, aliases);
}

/** One repeatable-read snapshot, without the workbench display limits. */
export function releaseProjectContent(input: { db: Database; services: ServiceResolver; identities?: ReleaseContentDirectory }) {
  return (raw: ProjectDeletionTarget) => input.db.transaction((tx) => releaseContentOver(tx, input, raw), { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
