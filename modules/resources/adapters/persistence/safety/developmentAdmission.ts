import { eq } from 'drizzle-orm';
import type { DevelopmentAdmissionReceipt, DevelopmentAdmissionState, WorkloadConsumer } from '@crewstation/contracts';
import { DevelopmentAdmissionReceiptSchema, DevelopmentAdmissionStateSchema, DevelopmentRemovalProtectionSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { drizzleRecordRepository } from '../drizzleRecords';
import { consumers } from './tables';

type Row = typeof consumers.$inferSelect;
/** Runs only after the original owner/parent/volume checks inside the registration transaction. */
export async function developmentAdmissionSelection(tx: Executor, consumer: WorkloadConsumer): Promise<DevelopmentAdmissionState | undefined> {
  const record = await drizzleRecordRepository(tx).get(consumer.resourceId), pod = record?.spec['pod'];
  if (!pod || typeof pod !== 'object' || Array.isArray(pod)) return undefined;
  const fields = pod as Record<string, unknown>;
  if (fields['developmentRemovalProtection'] === undefined) return undefined;
  if (!DevelopmentRemovalProtectionSchema.safeParse(fields['developmentRemovalProtection']).success) throw conflict('原开发准入回执选择无效');
  const annotations = fields['annotations'] as Record<string, unknown> | undefined;
  return DevelopmentAdmissionStateSchema.parse({ version: 1, intentHash: annotations?.['crewstation.io/cli-intent'], secretUid: null });
}
/** Caller holds the original storage-task lock; closure does not erase a verified original creation fact. */
export async function bindDevelopmentAdmission(tx: Executor, row: Row, raw: DevelopmentAdmissionReceipt): Promise<Row> {
  const receipt = DevelopmentAdmissionReceiptSchema.parse(raw), selected = row.developmentAdmission;
  if (!selected || !row.startPermit) throw precondition('原开发准入回执尚未选定或启动许可缺失');
  const state = DevelopmentAdmissionStateSchema.parse(selected), { grantedAt: _at, ...permit } = row.startPermit;
  if (jsonHash(row.consumer) !== jsonHash(receipt.consumer) || jsonHash(permit) !== jsonHash(receipt.permit) || state.intentHash !== receipt.intentHash) throw conflict('准入创建回执不属于原消费者、意图或许可');
  if (state.secretUid !== null) {
    if (state.secretUid !== receipt.secretUid) throw conflict('原准入 Secret UID 不可替换');
    return row;
  }
  const developmentAdmission = { ...state, secretUid: receipt.secretUid };
  await tx.update(consumers).set({ developmentAdmission }).where(eq(consumers.id, row.id));
  return { ...row, developmentAdmission };
}
