import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { conflict, jsonHash } from '@crewstation/kernel';
import type { UsageRecord, UsageNativeCapture } from '@crewstation/contracts';
import type { NativeCaptureDocument } from '../../../domain/usageProjection';
import type { NativeLegacyOwner } from '../../../domain/developmentUsage/nativeLegacyAdoption';
import { pagedNativeRecordId } from '../../../domain/developmentUsage/nativeStepOwner';
import type { NativeOriginalStep } from '../../../domain/developmentUsage/nativeOriginalPage';
import type { CompleteNativePath } from '../../../ports/completeNativeScope';
import { readDevelopmentModel } from '../developmentUsageModels';

/** Two candidates prove ambiguity; this is owner resolution, never an aggregate population limit. */
export async function readNativeLegacyOwners(db: Executor, taskKey: string, path: CompleteNativePath,
  before: NativeOriginalStep): Promise<NativeLegacyOwner[]> {
  const rows = await db.execute<{ document: NativeCaptureDocument; summary: UsageNativeCapture }>(sql`
    SELECT capture.document,capture.summary FROM observability.native_steps step
    JOIN observability.native_captures capture ON capture.id=step.capture_id
    WHERE step.task_key=${taskKey} AND step.record_id=${pagedNativeRecordId(before.step)}
      AND step.root=${path.root} ORDER BY capture.id LIMIT 2`);
  const result: NativeLegacyOwner[] = [];
  for (const row of rows) {
    const meter = { identity: row.document.identity, sourceId: row.document.sourceId, recordId: pagedNativeRecordId(before.step) };
    const usage = (await db.execute<{ document: UsageRecord }>(sql`SELECT document FROM observability.usage_projections
      WHERE meter_key=${jsonHash(meter)}`))[0]?.document;
    if (!usage) continue;
    result.push({ capture: row.document, summary: row.summary, usage,
      model: await readDevelopmentModel(db, meter, usage.projection.modelRevision ?? usage.revision) });
  }
  // An unresolved second candidate remains ambiguous instead of accidentally selecting the first valid meter.
  if (rows.length !== result.length) throw conflict('原 legacy 数字 owner 尚未解析，不能证明该调用不存在');
  return result;
}
