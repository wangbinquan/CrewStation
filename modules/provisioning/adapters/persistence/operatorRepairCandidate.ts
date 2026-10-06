import { ProjectDeletionRepairItemSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { readContentConfirmation } from '@crewstation/persistence';
import type { Executor } from '@crewstation/persistence';
import type { QueueContentItem } from '@crewstation/queue';
import type { EventContentItem } from '@crewstation/eventbus';
import { queueContentContains } from '@crewstation/queue';
import { eventContentContains } from '@crewstation/eventbus';
import { z } from 'zod';
import { hasRetentionTarget, retainableDocument, retentionReferences } from '../../domain/retentionScope';
import { historicalReleaseReferences } from '../../domain/historicalReleaseInventory';
import type { InfrastructureContentRow } from '../../domain/infrastructureContents';
import type { InfrastructureOriginDocument } from '../../domain/infrastructureOrigins';
import type { InfrastructureOriginSources } from '../../ports/infrastructureOrigins';

export const queueRepairRow = (row: QueueContentItem): InfrastructureContentRow => ({ ...row, deadLetters: 0,
  document: { channel: 'queue', name: row.kind, payload: row.payload, legacyPayload: row.legacyPayload, identityProvenance: row.identityProvenance } });
export const eventRepairRow = (row: EventContentItem): InfrastructureContentRow => ({ ...row,
  document: { channel: 'event', name: row.topic, payload: row.payload, legacyPayload: row.legacyPayload, identityProvenance: row.identityProvenance } });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const profileEvidence = z.object({ complete: z.literal(true), id: ResourceIdSchema, retired: z.boolean(), active: z.boolean(), aliases: z.array(z.string().min(1)), digest: hash }).strict();
const assetEvidence = z.object({ complete: z.literal(true), digest: hash, activeConsumers: z.array(z.string()), targetReferences: z.array(z.string()) }).passthrough();

async function repairReferences(document: InfrastructureOriginDocument, origins: InfrastructureOriginSources) {
  try { return { ...retentionReferences(document), reproduced: false }; }
  catch (error) {
    if (!origins.historicalReleaseNormalization) throw error;
    const references = historicalReleaseReferences(document);
    if (jsonHash(await origins.historicalReleaseNormalization(document)) !== jsonHash(document.payload))
      throw precondition('历史发布事件与完整原迁移重新推导不符');
    return { ...references, reproduced: true };
  }
}

/** Explicit negative retention only. No missing source is assigned project/platform ownership. */
export async function provisionRepairCandidate(db: Executor, origins: InfrastructureOriginSources, target: ProjectDeletionTarget, row: InfrastructureContentRow, state?: string) {
  const document = row.document;
  if (!retainableDocument(document) || !origins.currentAssets) return undefined;
  const references = await repairReferences(document, origins), blockers: string[] = [];
  const witnesses = await Promise.all([...references.current.map(async ref => ({ representation: 'current', ref, source: await origins.resolve(document, ref, 'current') ?? null })),
    ...references.legacy.map(async ref => ({ representation: 'legacy', ref, source: await origins.resolve(document, ref, 'legacy') ?? null }))]);
  if (witnesses.some(witness => witness.source !== null)) return undefined;
  let profile: z.infer<typeof profileEvidence> | null = null;
  if (document.name === 'agent-runtime.profile-test') {
    if (!origins.currentProfileTestEvidence) return undefined;
    profile = profileEvidence.parse(await origins.currentProfileTestEvidence(references.current[0]!.key));
    if (profile.id !== references.current[0]!.key || profile.active || !profile.retired && profile.aliases.length) blockers.push('尚有当前测试或未知标识关系，不能使用来源消失的保留决定');
    if (references.legacy.some(ref => !profile!.aliases.includes(ref.key))) blockers.push('旧测试键与当前保留身份不一致');
  } else if (!references.reproduced && references.legacy.some((ref, index) => ref.kind !== references.current[index]?.kind || ref.key !== references.current[index]?.key)) {
    blockers.push('旧引用缺少与当前标识相同的原来源，不能确认原迁移关系');
  }
  const ids = [...new Set([...references.current, ...references.legacy].map(ref => ref.key).concat(profile?.aliases ?? []))];
  const current = await origins.currentAssets.inspect(target, { ids }); assetEvidence.parse(current);
  if (document.channel === 'queue' && !['done', 'dead'].includes(state ?? '') || current.activeConsumers.length) blockers.push('队列或匹配消费者仍在活动，不能保留为旧历史');
  const fragments = [target.id, target.serviceId, target.namespace, target.prodHost, target.previewHost, target.serviceHost,
    JSON.stringify(target.slug), target.slug + '.', target.slug + '/', '/' + target.slug, 'cs-' + target.slug, target.slug + '-'].filter((value): value is string => !!value);
  const privateReference = await (document.channel === 'queue' ? queueContentContains : eventContentContains)(db, row, fragments);
  if (privateReference || current.targetReferences.length || hasRetentionTarget(document.payload, target) || hasRetentionTarget(document.legacyPayload, target) || ids.some(id => hasRetentionTarget(id, target))) blockers.push('完整原内容或当前消费者存在目标项目或共享反向引用');
  const key = document.channel + ':' + row.id;
  const targetIdentity = { id: target.id, serviceId: target.serviceId, slug: target.slug, namespace: target.namespace,
    prodHost: target.prodHost, previewHost: target.previewHost, serviceHost: target.serviceHost };
  const evidenceDigest = jsonHash({ version: 'operator-confirmed/v1', target: targetIdentity, birth: row.birthDigest, witnesses, profile, current,
    ...(references.reproduced ? { historicalReproduction: jsonHash(document.payload) } : {}) });
  const saved = await readContentConfirmation(db, 'provisioning', { context: target.id, key, source: row.contentDigest, evidence: evidenceDigest });
  return ProjectDeletionRepairItemSchema.parse({ owner: 'provisioning', key, title: document.channel === 'queue' ? '旧任务完整保留 ' + row.id : '旧事件完整保留 ' + row.id,
    originalDigest: row.contentDigest, evidenceDigest, facts: [
      { label: '原类型', value: document.name }, { label: '原记录状态', value: state ?? `事件；含 ${row.deadLetters} 条原错误` },
      { label: '原来源', value: profile?.retired ? '当前原测试已缺失，仅保留淘汰身份；历史归属仍未知' : '公开原来源已缺失；历史归属仍未知' },
      ...witnesses.map(witness => ({ label: `${witness.representation === 'current' ? '当前' : '历史'}原引用 ${witness.ref.kind}`, value: witness.ref.key })),
      ...(profile?.aliases ?? []).map(value => ({ label: '保留旧键', value })), { label: '原出生摘要', value: row.birthDigest }, { label: '完整原文及错误摘要', value: row.contentDigest },
      { label: '决定的影响', value: '仅本次目标不回收此完整记录及错误；未知关联资源不认领、不回收，不补写历史或重投' }],
    blockers, allowedDecisions: blockers.length ? [] : ['retain'], confirmed: saved && !blockers.length ? { decision: saved.decision, actorId: saved.actor, confirmedAt: saved.at } : null });
}
