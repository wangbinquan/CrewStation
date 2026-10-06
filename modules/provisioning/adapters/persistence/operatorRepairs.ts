import { ConfirmProjectDeletionRepairSchema, ProjectDeletionRepairItemSchema } from '@crewstation/contracts';
import type { ProjectDeletionRepairItem, ProjectDeletionRepairOwner, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { appendContentConfirmation, readContentConfirmation, withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { readQueueContents } from '@crewstation/queue';
import type { QueueContentItem } from '@crewstation/queue';
import { z } from 'zod';
import { infrastructureOriginReferences } from '../../domain/infrastructureOrigins';
import type { InfrastructureContentRow } from '../../domain/infrastructureContents';
import type { InfrastructureOriginSources } from '../../ports/infrastructureOrigins';

const originalPayload = z.object({ testId: z.string().min(1) }).strict();
async function candidate(db: Executor, origins: InfrastructureOriginSources, target: ProjectDeletionTarget, row: QueueContentItem): Promise<ProjectDeletionRepairItem | undefined> {
  if (row.kind !== 'agent-runtime.profile-test' || !origins.currentAssets || !origins.currentProfileTestEvidence) return undefined;
  const document = { channel: 'queue' as const, name: row.kind, payload: row.payload, legacyPayload: row.legacyPayload, identityProvenance: row.identityProvenance };
  const references = infrastructureOriginReferences(document), id = references.current[0]!.key;
  if (await origins.resolve(document, references.current[0]!, 'current')) return undefined;
  if (row.legacyPayload !== null && row.legacyPayload !== undefined) originalPayload.parse(row.legacyPayload);
  const source = await origins.currentProfileTestEvidence(id), current = await origins.currentAssets.inspect(target, { ids: [id, ...source.aliases] });
  const blockers: string[] = [];
  if (source.id !== id || !source.retired || source.active) blockers.push('原测试并非仅保留的淘汰身份，或仍有当前测试消费者');
  if (references.legacy.some((ref) => !source.aliases.includes(ref.key))) blockers.push('旧测试键与当前保留身份不一致');
  if (!['done', 'dead'].includes(row.state) || current.activeConsumers.length) blockers.push('该队列或当前消费者仍在活动，不能保留为旧历史');
  if (current.targetReferences.length) blockers.push('测试内容出现目标项目的当前反向引用');
  const evidenceDigest = jsonHash({ version: 'operator-confirmed/v1', project: target.id, birth: row.birthDigest, source, current });
  const saved = await readContentConfirmation(db, 'provisioning', { context: target.id, key: 'queue:' + row.id, source: row.contentDigest, evidence: evidenceDigest });
  return ProjectDeletionRepairItemSchema.parse({ owner: 'provisioning', key: 'queue:' + row.id, title: '旧档位测试队列 ' + row.id, originalDigest: row.contentDigest, evidenceDigest,
    facts: [{ label: '原测试标识', value: id }, { label: '完整原队列状态', value: row.state }, { label: '原上下文', value: '缺失，仅保留淘汰身份；归属仍未知' },
      ...source.aliases.map((value) => ({ label: '保留旧键', value })), { label: '决定的影响', value: '仅确认本项目不回收此完整队列；不新增全平台豁免或补写原测试' }],
    blockers, allowedDecisions: blockers.length ? [] : ['retain'], confirmed: saved && !blockers.length ? { decision: saved.decision, actorId: saved.actor, confirmedAt: saved.at } : null });
}
export async function provisionRepairItems(db: Executor, origins: InfrastructureOriginSources, target: ProjectDeletionTarget) {
  const items: ProjectDeletionRepairItem[] = []; let after: string | null = null;
  for (;;) {
    const rows = await readQueueContents(db, after, 200, 'agent-runtime.profile-test');
    if (!rows.length) break;
    for (const row of rows) { const item = await candidate(db, origins, target, row); if (item) items.push(item); after = row.id; }
  }
  return items;
}
export async function retainedProvisionContent(db: Executor, origins: InfrastructureOriginSources, target: ProjectDeletionTarget, original: InfrastructureContentRow) {
  if (original.document.channel !== 'queue' || original.document.name !== 'agent-runtime.profile-test') return undefined;
  const [row] = await readQueueContents(db, BigInt(original.id) === 1n ? null : (BigInt(original.id) - 1n).toString(), 1, 'agent-runtime.profile-test');
  if (!row || row.id !== original.id || row.contentDigest !== original.contentDigest || row.birthDigest !== original.birthDigest) return undefined;
  const item = await candidate(db, origins, target, row);
  return item?.confirmed?.decision === 'retain' ? jsonHash(item) : undefined;
}
export function provisioningOperatorRepairs(db: Database, origins: InfrastructureOriginSources): ProjectDeletionRepairOwner {
  return { inspect: (target) => provisionRepairItems(db, origins, target), confirm: (target, actor, raw) => withExclusiveDatabaseAdmission(db, 'provisioning.project-admission:' + target.id, async (tx) => {
    const input = ConfirmProjectDeletionRepairSchema.parse(raw), item = (await provisionRepairItems(tx, origins, target)).find((item) => item.key === input.key);
    if (!actor.isAdmin || !item || input.owner !== 'provisioning' || item.originalDigest !== input.originalDigest || item.evidenceDigest !== input.evidenceDigest || !item.allowedDecisions.includes(input.decision)) throw precondition('档位测试确权候选已变化或不能作此决定');
    await appendContentConfirmation(tx, 'provisioning', { context: target.id, key: item.key, source: item.originalDigest, evidence: item.evidenceDigest, decision: input.decision, actor: actor.userId, at: new Date().toISOString(), value: { version: 'operator-confirmed/v1', item } });
    const fresh = (await provisionRepairItems(tx, origins, target)).find((entry) => entry.key === item.key);
    if (!fresh?.confirmed || fresh.originalDigest !== item.originalDigest || fresh.evidenceDigest !== item.evidenceDigest) throw precondition('档位测试来源在保存期间变化，未保存确认');
    return fresh;
  }) };
}
