import { ConfirmProjectDeletionRepairSchema } from '@crewstation/contracts';
import type { ProjectDeletionRepairItem, ProjectDeletionRepairOwner, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { appendContentConfirmation, withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { readQueueContents } from '@crewstation/queue';
import { readEventContents } from '@crewstation/eventbus';
import { sql } from 'drizzle-orm';
import { retainableQueueKinds } from '../../domain/retentionScope';
import type { InfrastructureContentRow } from '../../domain/infrastructureContents';
import type { InfrastructureOriginSources } from '../../ports/infrastructureOrigins';
import { eventRepairRow, provisionRepairCandidate, queueRepairRow } from './operatorRepairCandidate';

export async function provisionRepairItems(db: Executor, origins: InfrastructureOriginSources, target: ProjectDeletionTarget) {
  const items: ProjectDeletionRepairItem[] = [];
  for (const kind of retainableQueueKinds) {
    let after: string | null = null;
    for (;;) {
      const rows = await readQueueContents(db, after, 200, kind); if (!rows.length) break;
      for (const row of rows) { const item = await provisionRepairCandidate(db, origins, target, queueRepairRow(row), row.state); if (item) items.push(item); after = row.id; }
    }
  }
  let after: string | null = null;
  for (;;) {
    const rows = await readEventContents(db, after); if (!rows.length) break;
    for (const row of rows) { const item = await provisionRepairCandidate(db, origins, target, eventRepairRow(row)); if (item) items.push(item); after = row.id; }
  }
  return items;
}
export async function retainedProvisionContent(db: Executor, origins: InfrastructureOriginSources, target: ProjectDeletionTarget, original: InfrastructureContentRow) {
  const entry = await repairByKey(db, origins, target, original.document.channel + ':' + original.id);
  if (!entry || entry.row.contentDigest !== original.contentDigest || entry.row.birthDigest !== original.birthDigest || jsonHash(entry.row.document) !== jsonHash(original.document)) return undefined;
  const item = entry.item;
  return item?.confirmed?.decision === 'retain' ? jsonHash(item) : undefined;
}
async function repairByKey(db: Executor, origins: InfrastructureOriginSources, target: ProjectDeletionTarget, key: string) {
  const match = /^(queue|event):([1-9][0-9]*)$/.exec(key); if (!match || BigInt(match[2]!) > 9223372036854775807n) return undefined;
  const id = match[2]!, after = id === '1' ? null : (BigInt(id) - 1n).toString();
  const [queue] = match[1] === 'queue' ? await readQueueContents(db, after, 1) : [];
  const [event] = match[1] === 'event' ? await readEventContents(db, after, 1) : [];
  const row = queue ? queueRepairRow(queue) : event ? eventRepairRow(event) : undefined;
  if (!row || row.id !== id) return undefined;
  const item = await provisionRepairCandidate(db, origins, target, row, queue?.state);
  return item ? { row, item } : undefined;
}
export function provisioningOperatorRepairs(db: Database, origins: InfrastructureOriginSources): ProjectDeletionRepairOwner {
  return { inspect: (target) => db.transaction(async tx => { await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`); return provisionRepairItems(tx, origins, target); }), confirm: (target, actor, raw) => withExclusiveDatabaseAdmission(db, 'provisioning.project-admission:' + target.id, async (tx) => {
    const input = ConfirmProjectDeletionRepairSchema.parse(raw), item = (await repairByKey(tx, origins, target, input.key))?.item;
    if (!actor.isAdmin || !item || input.owner !== 'provisioning' || item.originalDigest !== input.originalDigest || item.evidenceDigest !== input.evidenceDigest || !item.allowedDecisions.includes(input.decision)) throw precondition('旧任务或事件确权候选已变化或不能作此决定');
    await appendContentConfirmation(tx, 'provisioning', { context: target.id, key: item.key, source: item.originalDigest, evidence: item.evidenceDigest, decision: input.decision, actor: actor.userId, at: new Date().toISOString(), value: { version: 'operator-confirmed/v1', item } });
    const fresh = (await repairByKey(tx, origins, target, item.key))?.item;
    if (!fresh?.confirmed || fresh.originalDigest !== item.originalDigest || fresh.evidenceDigest !== item.evidenceDigest) throw precondition('原来源在保存期间变化，未保存确认');
    return fresh;
  }) };
}
