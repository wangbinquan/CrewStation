import type { Executor } from '@crewstation/persistence';
import { and, asc, eq, gt, lte } from 'drizzle-orm';
import { conflict, jsonHash } from '@crewstation/kernel';
import type { UsageRecord } from '@crewstation/contracts';
import type { UsageEvidence } from '../../../domain/usageProjection';
import { rebuildUsageProjection } from '../../../domain/usageProjection';
import type { NativeLedgerReference } from '../../../domain/developmentUsage/nativeLedgerReference';
import { nativeRepairs, usageEvidence } from '../tables';

export async function readNativeReferenceProjection(db: Executor, reference: NativeLedgerReference): Promise<UsageRecord | undefined> {
  const key = jsonHash(reference.meter), retained: UsageEvidence[] = [];
  for (let after = 0;;) {
    const rows = await db.select().from(usageEvidence).where(and(eq(usageEvidence.meterKey, key),
      gt(usageEvidence.revision, after), lte(usageEvidence.revision, reference.evidenceRevision)))
      .orderBy(asc(usageEvidence.revision)).limit(200);
    retained.push(...rows.map(row => row.document));
    if (rows.length < 200) break;
    after = rows.at(-1)!.revision;
  }
  const selected = retained.at(-1);
  if (!selected || selected.revision !== reference.evidenceRevision || jsonHash(selected) !== reference.evidenceFingerprint ||
      jsonHash(selected.scope) !== reference.scopeFingerprint) return;
  return rebuildUsageProjection(retained);
}
export async function persistNativeReference(db: Executor, taskKey: string, reference: NativeLedgerReference): Promise<void> {
  const projection = await readNativeReferenceProjection(db, reference);
  if (!projection || jsonHash({ projectId: projection.identity.projectId, taskId: projection.identity.taskId }) !== taskKey)
    throw conflict('原生修订引用必须指向同一任务已持久的原数值证据');
  const meterKey = jsonHash(reference.meter), nativeKey = 'development-paged:' + reference.ownerKey;
  await db.insert(nativeRepairs).values({ meterKey, taskKey, nativeKey, active: true,
    valuationKey: jsonHash({ kind: 'valuation', usageKey: meterKey }), document: reference })
    .onConflictDoUpdate({ target: nativeRepairs.meterKey, set: { nativeKey, active: true, document: reference } });
}
