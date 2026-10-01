// RFC-034: replay before closure is evidence-only; a failed CAS or missing capability never ACKs the creator.
import { expect, test } from 'bun:test';
import { DevelopmentAdmissionReceiptSchema } from '@crewstation/contracts';
import type { ClusterWriter } from '../../ports/cluster';
import type { LedgerObservations } from '../../ports/ledger';
import { commitDevelopmentAdmissionReceipt, replayDevelopmentAdmissionReceipts } from './admissionReceipts';

const id = (n: number) => '019f0000-0000-7000-8000-' + String(n).padStart(12, '0');
function fixture() {
  const receipt = DevelopmentAdmissionReceiptSchema.parse({ version: 1, consumer: { id: id(1), resourceId: id(2), taskId: id(3), namespace: 'cs-receipt', podName: 'original-agent', revision: 1, purpose: 'agent', finalization: null, volumeUid: crypto.randomUUID() },
    permit: { podUid: crypto.randomUUID(), nodeName: 'original-node', nodeUid: crypto.randomUUID() }, intentHash: 'a'.repeat(64), secretUid: crypto.randomUUID() });
  const calls: string[] = [], pending = [receipt], state = { consumer: receipt.consumer, admissionClosed: true, startPermit: { ...receipt.permit, grantedAt: '2026-10-01T00:00:00.000Z' }, stopProof: null,
    developmentAdmission: { version: 1 as const, intentHash: receipt.intentHash, secretUid: receipt.secretUid } };
  const safety = { get: async () => state, closeConsumer: async () => state, recordStop: async () => { throw new Error('no stop'); },
    bindDevelopmentAdmission: async () => { calls.push('bind'); return state; } } satisfies NonNullable<LedgerObservations['workloadSafety']>;
  const cluster = { pendingDevelopmentAdmissionReceipts: () => pending, acknowledgeDevelopmentAdmissionReceipt: () => { calls.push('ack'); pending.pop(); },
    activateWorkload: async () => { throw new Error('must not activate'); }, inspectWorkloadStart: async () => { throw new Error('must not inspect'); } } as unknown as ClusterWriter;
  const ledger = { workloadSafety: safety, get: async () => { throw new Error('must not read ledger'); } } as unknown as LedgerObservations;
  return { receipt, calls, pending, state, safety, cluster, ledger };
}
test('closed or absent original records still commit only the creator receipt and ACK after verified same-UID CAS', async () => {
  const f = fixture(); await replayDevelopmentAdmissionReceipts(f, id(99)); expect(f.calls).toEqual([]);
  await replayDevelopmentAdmissionReceipts(f, f.receipt.consumer.resourceId); expect(f.calls).toEqual(['bind', 'ack']); expect(f.pending).toEqual([]); expect(f.state.admissionClosed).toBe(true);
});
test('failed persistence, incomplete confirmation, permit conflict and missing capability retain the original receipt', async () => {
  const f = fixture(); const bind = f.safety.bindDevelopmentAdmission;
  f.safety.bindDevelopmentAdmission = async () => { throw new Error('PG down'); };
  await expect(commitDevelopmentAdmissionReceipt(f.safety, f.cluster, f.receipt)).rejects.toThrow('PG down'); expect(f.pending).toEqual([f.receipt]);
  f.safety.bindDevelopmentAdmission = bind; f.state.developmentAdmission.secretUid = crypto.randomUUID();
  await expect(commitDevelopmentAdmissionReceipt(f.safety, f.cluster, f.receipt)).rejects.toThrow('保存未确认');
  f.state.developmentAdmission.secretUid = f.receipt.secretUid; f.state.startPermit.nodeUid = crypto.randomUUID();
  await expect(commitDevelopmentAdmissionReceipt(f.safety, f.cluster, f.receipt)).rejects.toThrow('启动许可');
  await expect(commitDevelopmentAdmissionReceipt(undefined, f.cluster, f.receipt)).rejects.toThrow('未装配');
  expect(f.pending).toEqual([f.receipt]); expect(f.calls).not.toContain('ack');
});
