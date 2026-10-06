import { ConfirmProjectDeletionRepairSchema, ProjectDeletionRepairItemSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { Actor, ProjectDeletionCurrentAssets, ProjectDeletionRepairItem, ProjectDeletionRepairOwner, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { appendContentConfirmation, readContentConfirmation, readTransactionPages, withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { BusinessDeletionSources } from '../../../ports/deletion/sources';

interface Row extends Record<string, unknown> { body: Record<string, unknown>; digest: string; project_id: string | null; service_id: string | null }
/** A reviewed negative decision concerns this whole foreign child, without inventing its missing runtime owner. */
async function candidate(db: Executor, sources: BusinessDeletionSources, assets: ProjectDeletionCurrentAssets, target: ProjectDeletionTarget, row: Row): Promise<ProjectDeletionRepairItem | undefined> {
  const body = row.body, spec = body['spec'] as { execution?: { taskId?: string } } | null, runtime = spec?.execution?.taskId;
  if (!runtime || await sources.resolve('task', runtime, 'current')) return undefined;
  const key = JSON.stringify([body['id']]), source = row.service_id ? await sources.resolve('service', row.service_id, 'current') : undefined;
  const legacy = body['legacy_spec'] as { execution?: { taskId?: string } } | null;
  const current = await assets.inspect(target, { ids: [runtime, ...(legacy?.execution?.taskId ? [legacy.execution.taskId] : [])] });
  const blockers: string[] = [];
  if (!source?.complete || source.scope !== 'project' || source.projectIds.length !== 1 || source.projectIds[0] !== row.project_id || source.id !== row.service_id) blockers.push('原父任务与当前公开服务归属无法一致核对');
  if (row.project_id === target.id || row.service_id === target.serviceId || current.targetReferences.length) blockers.push('存在目标项目的当前反向引用，不能保留为项目外历史');
  if (current.activeConsumers.length || !['succeeded', 'failed', 'cancelled'].includes(String(body['state']))) blockers.push('仍有活跃消费者或尚未结束的业务条目');
  const shared = await db.execute(sql`SELECT 1 FROM business_task.subtasks s LEFT JOIN business_task.tasks t ON t.id=s.task_id
    WHERE s.spec->'execution'->>'taskId'=${runtime} AND (t.project_id IS NULL OR t.project_id<>${row.project_id}) LIMIT 1`);
  if (shared.length) blockers.push('同一未知执行标识存在共享或无法核对的当前父引用');
  const evidenceDigest = jsonHash({ target: target.id, parent: { project: row.project_id, service: row.service_id, source: source ?? null }, runtime, current, shared: shared.length });
  const saved = await readContentConfirmation(db, 'business_task', { context: target.id, key: 'subtasks:' + key, source: row.digest, evidence: evidenceDigest });
  return ProjectDeletionRepairItemSchema.parse({ owner: 'business-task', key: 'subtasks:' + key, title: '旧业务子任务 ' + String(body['id']), originalDigest: row.digest, evidenceDigest,
    facts: [{ label: '当前父项目', value: row.project_id ?? '未知' }, { label: '缺失原运行环境', value: runtime }, { label: '当前条目状态', value: String(body['state']) },
      { label: '当前匹配的活跃消费者', value: current.activeConsumers.length ? String(current.activeConsumers.length) + ' 个，禁止确认' : '完整 Pod 分页未发现匹配的活跃消费者；不表示旧运行环境已停止' },
      { label: '处理范围', value: '仅确认本项目不回收此完整历史；原运行环境归属仍未知' }],
    allowedDecisions: blockers.length ? [] : ['retain'], blockers, confirmed: saved && !blockers.length ? { decision: saved.decision, actorId: saved.actor, confirmedAt: saved.at } : null });
}

export async function businessRepairItems(db: Executor, sources: BusinessDeletionSources, assets: ProjectDeletionCurrentAssets, target: ProjectDeletionTarget): Promise<ProjectDeletionRepairItem[]> {
  const items: ProjectDeletionRepairItem[] = [];
  await readTransactionPages<Row>(db, sql`SELECT to_jsonb(r) AS body,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS digest,t.project_id,t.service_id
    FROM business_task.subtasks r LEFT JOIN business_task.tasks t ON t.id=r.task_id WHERE r.spec->'execution'->>'taskId' IS NOT NULL ORDER BY r.id`, async (rows) => {
    for (const row of rows) { const item = await candidate(db, sources, assets, target, row); if (item) items.push(item); }
  });
  return items;
}

export async function retainedBusinessChild(db: Executor, sources: BusinessDeletionSources, assets: ProjectDeletionCurrentAssets | undefined, target: ProjectDeletionTarget, key: string, digest: string): Promise<string | undefined> {
  if (!assets) return undefined;
  const [id] = JSON.parse(key) as string[]; ResourceIdSchema.parse(id);
  const rows = await db.execute<Row>(sql`SELECT to_jsonb(r) AS body,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS digest,t.project_id,t.service_id
    FROM business_task.subtasks r LEFT JOIN business_task.tasks t ON t.id=r.task_id WHERE r.id=${id}`);
  if (rows.length !== 1 || rows[0]!.digest !== digest) return undefined;
  const item = await candidate(db, sources, assets, target, rows[0]!);
  return item?.confirmed?.decision === 'retain' ? jsonHash({ version: 'operator-confirmed/v1', target: target.id, source: item.originalDigest, evidence: item.evidenceDigest }) : undefined;
}

export function businessOperatorRepairs(db: Database, sources: BusinessDeletionSources, assets: ProjectDeletionCurrentAssets): ProjectDeletionRepairOwner {
  const inspect = (target: ProjectDeletionTarget) => db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    return businessRepairItems(tx, sources, assets, target);
  });
  return { inspect, confirm: (target, actor: Actor, raw) => withExclusiveDatabaseAdmission(db, 'business-task.project-admission:' + target.id, async (tx) => {
    const input = ConfirmProjectDeletionRepairSchema.parse(raw), items = await businessRepairItems(tx, sources, assets, target);
    const item = items.find((item) => item.key === input.key);
    if (!actor.isAdmin || !item || input.owner !== 'business-task' || item.originalDigest !== input.originalDigest || item.evidenceDigest !== input.evidenceDigest || !item.allowedDecisions.includes(input.decision)) throw precondition('业务确权候选已变化或不能作此决定，请重新核对');
    await appendContentConfirmation(tx, 'business_task', { context: target.id, key: item.key, source: item.originalDigest, evidence: item.evidenceDigest, decision: input.decision, actor: actor.userId, at: new Date().toISOString(), value: { version: 'operator-confirmed/v1', item } });
    const fresh = (await businessRepairItems(tx, sources, assets, target)).find((entry) => entry.key === item.key);
    if (!fresh?.confirmed || fresh.originalDigest !== item.originalDigest || fresh.evidenceDigest !== item.evidenceDigest) throw precondition('业务实际来源在保存期间变化，未保存确认');
    return fresh;
  }) };
}
