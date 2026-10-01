import type { DevelopmentAdmissionReceipt } from '@crewstation/contracts';
import { DevelopmentAdmissionReceiptSchema, DevelopmentAdmissionStateSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { ClusterWriter } from '../../ports/cluster';
import type { LedgerObservations } from '../../ports/ledger';

type Safety = LedgerObservations['workloadSafety'];
export function requireDevelopmentReceiptCapabilities(safety: Safety, cluster: ClusterWriter): void {
  if (!safety?.bindDevelopmentAdmission || !cluster.pendingDevelopmentAdmissionReceipts || !cluster.acknowledgeDevelopmentAdmissionReceipt) throw precondition('原准入回执的持久保存及确认能力未装配');
}
/** Only the original Resources CAS and exact creator ACK; no activation, cluster reads or reopening. */
export async function commitDevelopmentAdmissionReceipt(safety: Safety, cluster: ClusterWriter, raw: DevelopmentAdmissionReceipt): Promise<void> {
  requireDevelopmentReceiptCapabilities(safety, cluster);
  const receipt = DevelopmentAdmissionReceiptSchema.parse(raw), confirmed = await safety!.bindDevelopmentAdmission!(receipt);
  const state = DevelopmentAdmissionStateSchema.safeParse(confirmed.developmentAdmission);
  if (!state.success || !confirmed.startPermit || state.data.intentHash !== receipt.intentHash || state.data.secretUid !== receipt.secretUid || jsonHash(confirmed.consumer) !== jsonHash(receipt.consumer)) throw conflict('原准入回执保存未确认');
  const { grantedAt: _at, ...permit } = confirmed.startPermit;
  if (jsonHash(permit) !== jsonHash(receipt.permit)) throw conflict('原准入回执保存的启动许可不匹配');
  cluster.acknowledgeDevelopmentAdmissionReceipt!(receipt);
}
export async function replayDevelopmentAdmissionReceipts(deps: { ledger: LedgerObservations; cluster: ClusterWriter }, recordId: string): Promise<void> {
  for (const receipt of deps.cluster.pendingDevelopmentAdmissionReceipts?.() ?? []) {
    if (receipt.consumer.resourceId === recordId) await commitDevelopmentAdmissionReceipt(deps.ledger.workloadSafety, deps.cluster, receipt);
  }
}
