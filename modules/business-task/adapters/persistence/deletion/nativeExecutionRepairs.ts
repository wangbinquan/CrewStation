import { ProjectDeletionRepairItemSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionCurrentAssets, ProjectDeletionRepairItem, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { readContentConfirmation, readTransactionPages } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { BusinessWorkOriginSchema } from '../../../domain/deletion/work';
import type { BusinessDeletionSources } from '../../../ports/deletion/sources';
import { BUSINESS_CONTENT } from './contentTables';

type Entry = typeof BUSINESS_CONTENT[number];
interface Row extends Record<string, unknown> { table: string; key: string; digest: string; body: Record<string, unknown>;
  service: string | null; project: string | null; task: string | null; runtime: string | null; invalid: boolean }
const native = new Set(['execution_subtasks', 'execution_session_homes']);
const terminal = (state: unknown) => ['succeeded', 'failed', 'cancelled'].includes(String(state));
const field = (value?: string) => sql.raw(value ?? 'NULL::text');
const keyOf = (entry: Entry) => sql.raw('jsonb_build_array(' + entry.keys.map(column => 'r.' + column).join(',') + ')::text');
const textOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function identifiers(row: Row): string[] {
  const body = row.body, view = body['view'] as Record<string, unknown> | null;
  return [row.runtime, row.table === 'execution_subtasks' || row.table === 'execution_messages' ? body['id'] : null,
    body['session_key'], body['volume_uid'], body['session_volume_uid'], body['subtask_id'], body['source_execution_id'], view?.['executionId']]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}
function mentions(value: unknown, ids: readonly string[]): boolean {
  if (typeof value === 'string') return ids.some(id => value.includes(id));
  if (Array.isArray(value)) return value.some(entry => mentions(entry, ids));
  return !!value && typeof value === 'object' && Object.entries(value).some(([key, entry]) => mentions(key, ids) || mentions(entry, ids));
}
async function readRows(db: Executor, entry: Entry, ids?: readonly string[]): Promise<Row[]> {
  const rows: Row[] = [], key = keyOf(entry);
  const patterns = ids?.map(id => sql`${'%' + id.replace(/[\\%_]/g,'\\$&') + '%'}`);
  const where = patterns ? sql`to_jsonb(r)::text LIKE ANY(ARRAY[${sql.join(patterns,sql`, `)}]::text[])` : sql`${field(entry.runtime)} IS NOT NULL`;
  await readTransactionPages<Row>(db, sql`SELECT ${key} AS key,to_jsonb(r) AS body,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS digest,
    ${field(entry.service)} AS service,${field(entry.project)} AS project,${field(entry.task)} AS task,${field(entry.runtime)} AS runtime,
    ${sql.raw(entry.invalid ?? 'false')} AS invalid FROM ${sql.raw(entry.from ?? 'business_task.' + entry.table + ' r')}
    WHERE (${where}) ORDER BY ${key} COLLATE "C"`, async page => { rows.push(...page.map(row => ({ ...row, table: entry.table }))); });
  return rows;
}

/** Follow every execution/session/volume identifier to EOF, keeping private contents inside their owner. */
async function references(db: Executor, row: Row) {
  const ids = new Set(identifiers(row)); let related: Row[];
  for (;;) {
    related = [];
    for (const entry of BUSINESS_CONTENT) related.push(...await readRows(db, entry, [...ids].sort(textOrder)));
    const previous = ids.size;
    for (const entry of related) for (const id of identifiers(entry)) ids.add(id);
    if (ids.size === previous) return { rows: related, ids: [...ids].sort(textOrder) };
  }
}
async function parent(db: Executor, sources: BusinessDeletionSources, row: Row, targetIds: readonly string[]) {
  const service = row.service ? BusinessWorkOriginSchema.safeParse(await sources.resolve('service', row.service, 'current')) : undefined;
  if (service && !service.success || row.service && (!service?.success || service.data.id !== row.service)) return undefined;
  if (!row.task) return service?.success && row.project !== null && row.project !== service.data.projectIds[0] ? undefined
    : service?.success ? { project: service.data.projectIds[0]!, service: row.service, source: service.data, roots: [] } : undefined;
  ResourceIdSchema.parse(row.task);
  const roots = await db.execute<{ service_id: string; project_id: string; body: unknown; digest: string }>(sql`
    SELECT service_id,project_id,to_jsonb(t) AS body,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS digest FROM business_task.tasks t WHERE id=${row.task}
    UNION ALL SELECT service_id,intent->>'projectId',to_jsonb(o),encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex')
      FROM business_task.execution_operations o WHERE kind='create-task' AND intent->'task'->>'id'=${row.task}`);
  const task = BusinessWorkOriginSchema.safeParse(await sources.resolve('task', row.task, 'current'));
  if (!roots.length || !task.success || task.data.id !== row.task || roots.some(root => mentions(root.body, targetIds))) return undefined;
  const witnesses = [];
  for (const root of roots) {
    const source = BusinessWorkOriginSchema.safeParse(await sources.resolve('service', root.service_id, 'current'));
    if (!source.success || source.data.id !== root.service_id || source.data.projectIds[0] !== root.project_id || task.data.projectIds[0] !== root.project_id
      || row.service && row.service !== root.service_id || row.project !== null && row.project !== root.project_id) return undefined;
    witnesses.push({ service: root.service_id, project: root.project_id, source: source.data, root: root.digest });
  }
  if (new Set(witnesses.map(witness => JSON.stringify([witness.service, witness.project]))).size !== 1) return undefined;
  return { project: witnesses[0]!.project, service: witnesses[0]!.service, source: task.data, roots: witnesses.sort((a,b) => textOrder(a.root,b.root)) };
}
function pending(row: Row): boolean {
  const b = row.body;
  if (row.table === 'execution_subtasks') return !terminal((b['view'] as Record<string, unknown>)?.['state']) || b['runtime_released'] !== true
    || b['owner'] !== null || b['lease_until'] !== null || !['accepted', 'failed'].includes(String(b['dispatch']));
  if (row.table === 'execution_session_homes') return b['state'] !== 'idle' || b['lease_execution_id'] !== null;
  if (row.table === 'execution_messages') return !['succeeded','failed'].includes(String(b['state']));
  if (row.table === 'subtasks') return !terminal(b['state']);
  return row.table === 'original_callbacks' && b['exited_at'] === null;
}
interface EvidenceReads {
  related(row: Row): Promise<Awaited<ReturnType<typeof references>>>;
  parent(row: Row): ReturnType<typeof parent>;
  current(ids: readonly string[]): ReturnType<ProjectDeletionCurrentAssets['inspect']>;
}
function cached<T>(cache: Map<string, Promise<T>>, key: string, read: () => Promise<T>): Promise<T> {
  let value = cache.get(key); if (!value) { value = read(); cache.set(key,value); } return value;
}
async function candidate(db: Executor, sources: BusinessDeletionSources, target: ProjectDeletionTarget, row: Row, reads: EvidenceReads) {
  if (!row.runtime) return undefined;
  ResourceIdSchema.parse(row.runtime); ResourceIdSchema.parse(JSON.parse(row.key)[0]);
  if (await sources.resolve('task', row.runtime, 'current')) return undefined;
  const targetIds = [target.id,target.serviceId,target.namespace,target.slug,target.prodHost,target.previewHost,target.serviceHost].filter((id): id is string => !!id);
  const links = await reads.related(row), origin = await reads.parent(row), blockers: string[] = [];
  const facts = [];
  for (const reference of links.rows) {
    const source = await reads.parent(reference);
    const runtime = reference.runtime ? await sources.resolve('task',reference.runtime,'current') : undefined;
    const runtimeOrigin = runtime ? BusinessWorkOriginSchema.safeParse(runtime) : undefined;
    if (reference.invalid || !origin || !source || source.project !== origin.project || reference.task && reference.task !== row.task)
      blockers.push('完整关联中存在未知、冲突或共享的父任务／项目归属');
    if (runtime && (!runtimeOrigin?.success || runtimeOrigin.data.id !== reference.runtime || runtimeOrigin.data.projectIds[0] !== origin?.project))
      blockers.push('关联运行环境的公开原归属与父项目冲突');
    facts.push({ table: reference.table, key: reference.key, digest: reference.digest, source: source ?? null, runtime: runtime ?? null });
  }
  if (!links.rows.some(reference => reference.table === 'execution_subtasks' && reference.body['session_key'] === (row.body['session_key'] ?? row.runtime)))
    blockers.push('当前会话缺少可核对的原业务执行关联');
  const current = await reads.current(links.ids);
  if (!current.complete || current.activeConsumers.length || links.rows.some(pending)) blockers.push('当前完整关联仍有活跃消费者、租约或未结束条目');
  if (origin?.project === target.id || current.targetReferences.length || links.rows.some(reference => mentions(reference.body,targetIds))) blockers.push('存在目标项目引用，不能保留为项目外历史');
  const key = row.table + ':' + row.key, evidenceDigest = jsonHash({ target: target.id, origin: origin ?? null, references: facts, current });
  const saved = await readContentConfirmation(db, 'business_task', { context: target.id, key, source: row.digest, evidence: evidenceDigest });
  return ProjectDeletionRepairItemSchema.parse({ owner: 'business-task', key, title: (row.table === 'execution_subtasks' ? '旧原生业务执行 ' : '旧业务会话卷 ') + JSON.parse(row.key)[0], originalDigest: row.digest, evidenceDigest,
    facts: [{ label: '当前父项目', value: origin?.project ?? '未知' }, { label: '缺失原运行环境', value: row.runtime },
      { label: '当前条目状态', value: String(row.table === 'execution_subtasks' ? (row.body['view'] as Record<string, unknown>)?.['state'] : row.body['state']) },
      { label: '完整关联范围', value: String(links.rows.length) + ' 条业务执行、会话及反向引用；全部原正文摘要绑定本次确认' },
      { label: '当前匹配的活跃消费者', value: current.activeConsumers.length ? String(current.activeConsumers.length) + ' 个，禁止确认' : '完整 Pod 分页未发现匹配消费者；不表示旧运行环境已停止' },
      { label: '处理范围', value: '仅确认本项目不回收此完整历史及外项目资源；不恢复旧运行环境归属或补写退出证明' }],
    allowedDecisions: blockers.length ? [] : ['retain'], blockers: [...new Set(blockers)], confirmed: saved && !blockers.length ? { decision: saved.decision, actorId: saved.actor, confirmedAt: saved.at } : null });
}
export async function nativeExecutionRepairItems(db: Executor, sources: BusinessDeletionSources, assets: ProjectDeletionCurrentAssets, target: ProjectDeletionTarget): Promise<ProjectDeletionRepairItem[]> {
  const items: ProjectDeletionRepairItem[] = [];
  const sourceCache = new Map<string, ReturnType<BusinessDeletionSources['resolve']>>();
  const currentSources: BusinessDeletionSources = { ...sources, resolve: (kind,key,representation) => cached(sourceCache,JSON.stringify([kind,key,representation]),() => sources.resolve(kind,key,representation)) };
  const targetIds = [target.id,target.serviceId,target.namespace,target.slug,target.prodHost,target.previewHost,target.serviceHost].filter((id): id is string => !!id);
  const referenceCache = new Map<string, Promise<Awaited<ReturnType<typeof references>>>>(), parentCache = new Map<string, ReturnType<typeof parent>>();
  const currentCache = new Map<string, ReturnType<ProjectDeletionCurrentAssets['inspect']>>();
  const reads: EvidenceReads = {
    related: row => cached(referenceCache,JSON.stringify([row.task,row.service,row.body['volume_uid'] ?? row.body['session_volume_uid'] ?? row.runtime]),() => references(db,row)),
    parent: row => cached(parentCache,JSON.stringify([row.task,row.service,row.project]),() => parent(db,currentSources,row,targetIds)),
    current: ids => cached(currentCache,JSON.stringify(ids),() => assets.inspect(target,{ ids })),
  };
  for (const entry of BUSINESS_CONTENT.filter(entry => native.has(entry.table))) for (const row of await readRows(db, entry)) {
    const item = await candidate(db, currentSources, target, row, reads); if (item) items.push(item);
  }
  return items;
}
export async function retainedNativeExecutions(db: Executor, sources: BusinessDeletionSources, assets: ProjectDeletionCurrentAssets | undefined, target: ProjectDeletionTarget) {
  const items = assets ? await nativeExecutionRepairItems(db, sources, assets, target) : [];
  return new Map(items.filter(item => item.confirmed?.decision === 'retain').map(item => [item.key, { digest: item.originalDigest,
    decision: jsonHash({ version: 'operator-confirmed/v1', target: target.id, source: item.originalDigest, evidence: item.evidenceDigest }) }]));
}
