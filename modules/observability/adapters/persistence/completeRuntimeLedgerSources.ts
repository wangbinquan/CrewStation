import { and, asc, eq, gt, sql, type SQL } from 'drizzle-orm';
import { UsageRecordSchema, UsageValuationSchema, UsageNativeCaptureSchema, type RuntimeTaskHeaderFact } from '@crewstation/contracts';
import { jsonHash, validation } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { completeSourceCursor, completeSourcePosition } from '../../domain/completeSourceCursor';
import { runtimeLedgerScope } from '../../domain/runtimeIdentity';
import type { CompleteRuntimeLedgerSources } from '../../ports/completeRuntimeLedgerSources';
import type { CompleteSourceReader } from '../../ports/completeReport';
import { nativeReportCaptures } from './developmentUsage/nativeReportCaptures';
import { usageProjections, executionValuations, nativeCaptures, costVisibility, usageHeads } from './tables';

function selectedIdentity(identity: SQL, task: RuntimeTaskHeaderFact) {
  const scope = runtimeLedgerScope(task), common = sql`${identity}->>'projectId'=${scope.projectId} AND ${identity}->>'taskId'=${scope.taskId}`;
  return task.source?.kind === 'development-agent'
    ? sql`(${common}) AND ${identity}->>'sourceKind'='development-agent' AND ${identity}->>'executionId'=${task.id} AND ${identity}->>'executionGeneration'='1'`
    : sql`(${common}) AND ${identity}->>'sourceKind' IS NULL`;
}
/** Original current projections only; no transaction, giant identity IN, or shared remaining budget. */
export function completeRuntimeLedgerSources(db: Executor, task: RuntimeTaskHeaderFact, snapshotId: string, pageSize = 100): CompleteRuntimeLedgerSources {
  if (!snapshotId || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw validation('完整用量分页参数无效');
  const scope = runtimeLedgerScope(task), taskKey = jsonHash(scope), parent = jsonHash([task.id, scope, task.source ?? null]);
  const reader = <T>(source: string, read: (after: string | undefined) => Promise<{ items: readonly T[]; nextCursor: string | null }>): CompleteSourceReader<T> => ({
    next: async (cursor) => { const page = await read(completeSourcePosition(cursor, snapshotId, source, parent)); return { items: page.items, snapshotId, nextCursor: page.nextCursor === null ? null : completeSourceCursor(snapshotId, source, parent, page.nextCursor) }; },
  });
  return {
    snapshotId,
    ...(task.source?.kind === 'development-agent' ? { pagedCaptures: reader('native-pages', nativeReportCaptures(db, selectedIdentity(sql`p.document->'registration'->'identity'`, task), pageSize)) } : {}),
    usage: reader('usage', async (after) => {
      const rows = await db.select({ key: usageProjections.meterKey, document: usageProjections.document }).from(usageProjections)
        .where(and(eq(usageProjections.taskKey, taskKey), selectedIdentity(sql`${usageProjections.document}->'identity'`, task), after === undefined ? undefined : gt(usageProjections.meterKey, after)))
        .orderBy(asc(usageProjections.meterKey)).limit(pageSize + 1);
      const selected = rows.slice(0, pageSize);
      return { items: selected.map((row) => UsageRecordSchema.parse(row.document)), nextCursor: rows.length > pageSize ? selected.at(-1)!.key : null };
    }),
    valuations: reader('valuations', async (after) => {
      const rows = await db.select({ key: executionValuations.meterKey, document: executionValuations.document }).from(executionValuations)
        .where(and(eq(executionValuations.taskKey, taskKey), selectedIdentity(sql`${executionValuations.document}->'identity'`, task), after === undefined ? undefined : gt(executionValuations.meterKey, after)))
        .orderBy(asc(executionValuations.meterKey)).limit(pageSize + 1);
      const selected = rows.slice(0, pageSize);
      return { items: selected.map((row) => UsageValuationSchema.parse(row.document)), nextCursor: rows.length > pageSize ? selected.at(-1)!.key : null };
    }),
    captures: reader('captures', async (after) => {
      const rows = await db.select({ key: nativeCaptures.id, summary: nativeCaptures.summary }).from(nativeCaptures)
        .where(and(eq(nativeCaptures.taskKey, taskKey), selectedIdentity(sql`${nativeCaptures.summary}->'identity'`, task), after === undefined ? undefined : gt(nativeCaptures.id, after)))
        .orderBy(asc(nativeCaptures.id)).limit(pageSize + 1);
      const selected = rows.slice(0, pageSize);
      return { items: selected.map((row) => UsageNativeCaptureSchema.parse(row.summary)), nextCursor: rows.length > pageSize ? selected.at(-1)!.key : null };
    }),
    costVisible: async () => (await db.select().from(costVisibility).where(eq(costVisibility.projectId, task.projectId)).limit(1))[0]?.document.visibility === 'project-members-and-services',
    persistedThrough: async () => { const value = (await db.select({ sequence: usageHeads.sequence }).from(usageHeads).where(eq(usageHeads.taskKey, taskKey)).limit(1))[0]?.sequence ?? 0; if (!Number.isSafeInteger(value) || value < 0) throw validation('原用量水位无效'); return String(value); },
  };
}
