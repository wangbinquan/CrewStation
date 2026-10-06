import { ConfirmProjectDeletionRepairSchema, ProjectDeletionRepairItemSchema } from '@crewstation/contracts';
import type { AllowlistDocument, ProjectDeletionCurrentAssets, ProjectDeletionRepairItem, ProjectDeletionRepairOwner, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { appendContentConfirmation, readContentConfirmation, readTransactionPages, withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { GatewayOriginalDirectory } from '../../ports/repositories';
import { verifiedActiveForeignPod } from './foreignPodRetention';

const object = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw precondition('网关完整原记录不可读取');
  return raw as Record<string, unknown>;
};
const hasTarget = (raw: unknown, target: ProjectDeletionTarget): boolean => {
  if (typeof raw === 'string') return [target.id, target.serviceId, target.namespace, target.slug].includes(raw) || raw.startsWith(target.slug + '/');
  return !!raw && typeof raw === 'object' && Object.values(raw).some((value) => hasTarget(value, target));
};
interface Input { readonly originals: GatewayOriginalDirectory; readonly currentAssets: ProjectDeletionCurrentAssets }
async function finishItem(db: Executor, target: ProjectDeletionTarget, key: string, title: string, original: unknown, evidence: unknown, facts: ProjectDeletionRepairItem['facts'], blockers: string[]): Promise<ProjectDeletionRepairItem> {
  const originalDigest = jsonHash(original), evidenceDigest = jsonHash({ target: target.id, evidence });
  const saved = await readContentConfirmation(db, 'gateway', { context: target.id, key, source: originalDigest, evidence: evidenceDigest });
  return ProjectDeletionRepairItemSchema.parse({ owner: 'gateway', key, title, originalDigest, evidenceDigest, facts,
    blockers, allowedDecisions: blockers.length ? [] : ['retain'], confirmed: saved && !blockers.length ? { decision: saved.decision, actorId: saved.actor, confirmedAt: saved.at } : null });
}

export async function gatewayPodRepair(db: Executor, input: Input, target: ProjectDeletionTarget, raw: Record<string, unknown>): Promise<ProjectDeletionRepairItem> {
  const namespace = String(raw['namespace']), name = String(raw['pod_name']), uid = typeof raw['pod_uid'] === 'string' ? raw['pod_uid'] : null;
  const known = await input.originals.service(String(raw['project']) + '/' + String(raw['service']));
  const current = await input.currentAssets.inspect(target, { ids: [...(raw['task_id'] ? [String(raw['task_id'])] : [])], pods: [{ namespace, name, uid }] });
  const blockers: string[] = [];
  if (known?.projectId === target.id || hasTarget(raw, target) || current.targetReferences.length) blockers.push('网关记录存在目标项目的当前反向引用');
  const activeForeign = verifiedActiveForeignPod(target, raw, known, current);
  if (current.activeConsumers.length && !activeForeign) blockers.push('原名字或原 UID 仍有无法确证为外项目的活跃消费者，不能作历史保留确认');
  // This is a reviewed negative disposition, not a replacement service_source or Pod birth.
  return finishItem(db, target, 'pod:' + JSON.stringify([namespace, name]), '旧网关 Pod ' + namespace + '/' + name, raw, { current, known: known ?? null },
    [{ label: '实际 Pod UID', value: uid ?? '历史未记录' }, { label: '旧项目/服务', value: String(raw['project']) + '/' + String(raw['service']) },
      { label: '当前公开服务项目', value: known?.projectId ?? '未知，保留原未知状态' },
      ...(activeForeign ? [{ label: '本次严格保留', value: '当前公开归属为外项目；完整原记录及运行 Pod 均保留，不停止或回收，不补写旧出生' },
        ...current.pods!.flatMap((pod) => [{ label: '当前实际 Pod / UID', value: `${pod.namespace}/${pod.name} / ${pod.uid}` }, ...pod.containers.map((c) => ({ label: '当前实际容器', value: c.name + ' / ' + c.id }))])] : []), { label: '决定的影响', value: '本项目不回收该完整旧记录；不补写 service_source 或推断原进程停止' }], blockers);
}

export async function gatewayDocumentRepair(db: Executor, input: Input, target: ProjectDeletionTarget, raw: Record<string, unknown>): Promise<ProjectDeletionRepairItem> {
  const doc = object(raw['document']) as unknown as AllowlistDocument, blockers: string[] = [], facts: ProjectDeletionRepairItem['facts'] = [], ownership: unknown[] = [];
  if (doc.version !== raw['version'] || !Array.isArray(doc.entries) || !Array.isArray(doc.defaultOpen) || doc.operationRoutes !== undefined && !Array.isArray(doc.operationRoutes)) throw precondition('旧放行文档完整形状或版本无法核对');
  const operations = new Set<string>(doc.defaultOpen);
  for (const entry of doc.entries) {
    if (typeof entry.caller !== 'string' || !Array.isArray(entry.operations) || entry.operations.some((key) => typeof key !== 'string')) throw precondition('旧放行文档引用结构无法核对');
    const owner = await input.originals.service(entry.caller); ownership.push({ caller: entry.caller, owner: owner ?? null });
    if (owner?.projectId === target.id) blockers.push('旧放行文档仍有目标项目当前调用者');
    facts.push({ label: '原调用者', value: entry.caller || '空调用者' });
    for (const key of entry.operations) { operations.add(key); facts.push({ label: '原操作', value: key || '空操作' }); }
  }
  for (const route of doc.operationRoutes ?? []) { if (typeof route.id !== 'string') throw precondition('旧放行操作不完整'); operations.add(route.id); }
  for (const key of operations) {
    if (typeof key !== 'string') throw precondition('旧放行操作不完整');
    const owner = await input.originals.operation(key); ownership.push({ operation: key, owner: owner ?? null });
    if (owner === target.id) blockers.push('旧放行文档仍有目标项目当前操作');
    facts.push({ label: '原开放/路由操作', value: key || '空操作' });
  }
  const [latest] = await db.execute<{ version: number }>(sql`SELECT max(version)::integer AS version FROM gateway.allowlists`);
  if (latest?.version === raw['version']) blockers.push('此文档仍是当前消费版本，不能作为旧历史保留');
  if (hasTarget(raw, target)) blockers.push('旧文档包含目标项目的完整身份或命名空间引用');
  const current = await input.currentAssets.inspect(target, { ids: [] });
  return finishItem(db, target, 'allowlist:' + String(raw['version']), '旧放行文档 ' + String(raw['version']), raw, { ownership, current, isLatest: latest?.version === raw['version'] },
    [...facts, { label: '决定的影响', value: '保留完整原文及未知归属；不删除其中任何调用者或操作，不改变当前生效文档' }], [...new Set(blockers)]);
}

export function gatewayOperatorRepairs(db: Database, input: Input, unknown: {
  pod(db: Executor, body: Record<string, unknown>): Promise<boolean>;
  document(db: Executor, document: AllowlistDocument): Promise<boolean>;
}): ProjectDeletionRepairOwner {
  const inspect = async (target: ProjectDeletionTarget, executor: Executor) => {
    const items: ProjectDeletionRepairItem[] = [];
    await readTransactionPages<Record<string, unknown> & { body: Record<string, unknown> }>(executor, sql`SELECT to_jsonb(r) AS body FROM gateway.pod_identities r ORDER BY namespace,pod_name`, async (rows) => {
      for (const row of rows) if (await unknown.pod(executor, row.body)) items.push(await gatewayPodRepair(executor, input, target, row.body));
    });
    await readTransactionPages<Record<string, unknown> & { body: Record<string, unknown> }>(executor, sql`SELECT to_jsonb(r) AS body FROM gateway.allowlists r ORDER BY version`, async (rows) => {
      for (const row of rows) if (await unknown.document(executor, row.body['document'] as AllowlistDocument)) items.push(await gatewayDocumentRepair(executor, input, target, row.body));
    });
    return items;
  };
  return { inspect: (target) => db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    return inspect(target, tx);
  }), confirm: (target, actor, raw) => withExclusiveDatabaseAdmission(db, 'gateway.project-admission:' + target.id, async (tx) => {
    const input = ConfirmProjectDeletionRepairSchema.parse(raw), item = (await inspect(target, tx)).find((item) => item.key === input.key);
    if (!actor.isAdmin || !item || input.owner !== 'gateway' || item.originalDigest !== input.originalDigest || item.evidenceDigest !== input.evidenceDigest || !item.allowedDecisions.includes(input.decision)) throw precondition('网关确权候选已变化或不能作此决定');
    await appendContentConfirmation(tx, 'gateway', { context: target.id, key: item.key, source: item.originalDigest, evidence: item.evidenceDigest, decision: input.decision, actor: actor.userId, at: new Date().toISOString(), value: { version: 'operator-confirmed/v1', item } });
    const fresh = (await inspect(target, tx)).find((entry) => entry.key === item.key);
    if (!fresh?.confirmed || fresh.originalDigest !== item.originalDigest || fresh.evidenceDigest !== item.evidenceDigest) throw precondition('网关实际来源在保存期间变化，未保存确认');
    return fresh;
  }) };
}
