// RFC-034 v1 P2: retain a known original create response across PG/ACK failures; never evict it for a later create.
import { expect, test } from 'bun:test';
import type { DevelopmentAdmissionReceipt } from '@crewstation/contracts';
import { DevelopmentAdmissionReceiptSchema } from '@crewstation/contracts';
import { developmentAdmissionReceiptBuffer } from './developmentAdmissionReceipts';

const id = (n: number) => '019f0000-0000-7000-8000-' + String(n).padStart(12, '0');
function original(n = 1): DevelopmentAdmissionReceipt {
  return DevelopmentAdmissionReceiptSchema.parse({ version: 1, consumer: { id: id(n), resourceId: id(n + 1000), taskId: id(999), namespace: 'cs-receipt', podName: 'original-' + n, revision: 1, purpose: 'agent', finalization: null, volumeUid: 'fbe0d60f-3556-4b9d-9c73-f81b652d3288' },
    permit: { podUid: '94cc5637-4e9e-4417-8668-2d299188a2ed', nodeName: 'original-node', nodeUid: 'a91180a3-3ab0-49cf-ae6b-7a626a8243d4' }, intentHash: 'a'.repeat(64), secretUid: crypto.randomUUID() });
}
const seed = ({ secretUid: _uid, ...identity }: DevelopmentAdmissionReceipt) => identity;
test('successful original response stays immutable until the exact matching ACK; same UID replay never creates again', async () => {
  const buffer = developmentAdmissionReceiptBuffer(), receipt = original(); let creates = 0;
  const result = await buffer.create(seed(receipt), async () => { creates++; return receipt; });
  expect(result).toEqual(receipt); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.consumer)).toBe(true); expect(Object.isFrozen(result.permit)).toBe(true);
  await expect(buffer.create(seed(receipt), async () => { throw new Error('must not recreate'); })).resolves.toEqual(receipt);
  expect(() => buffer.acknowledge({ ...receipt, secretUid: crypto.randomUUID() })).toThrow(); expect(buffer.pending()).toEqual([receipt]);
  await expect(buffer.create({ ...seed(receipt), intentHash: 'b'.repeat(64) }, async () => receipt)).rejects.toThrow();
  buffer.acknowledge(receipt); buffer.acknowledge(receipt); expect(buffer.pending()).toEqual([]); expect(creates).toBe(1);
});
test('the same original identity shares an in-flight create and never exposes its reservation as a successful receipt', async () => {
  const buffer = developmentAdmissionReceiptBuffer(), receipt = original(); let finish!: (r: DevelopmentAdmissionReceipt) => void, creates = 0;
  const a = buffer.create(seed(receipt), () => { creates++; return new Promise((done) => { finish = done; }); });
  const b = buffer.create(seed(receipt), async () => { creates++; return receipt; });
  expect(buffer.pending()).toEqual([]); finish(receipt); expect(await a).toEqual(receipt); expect(await b).toEqual(receipt); expect(creates).toBe(1);
});
test('all 128 in-flight reservations count toward capacity and the 129th rejects before its creator is called', async () => {
  const buffer = developmentAdmissionReceiptBuffer(), finishers: Array<() => void> = [], receipts = Array.from({ length: 128 }, (_, n) => original(n + 1)); let overflowCalls = 0;
  const writes = receipts.map((receipt) => buffer.create(seed(receipt), () => new Promise((done) => finishers.push(() => done(receipt)))));
  expect(buffer.pending()).toEqual([]);
  await expect(buffer.create(seed(original(129)), async () => { overflowCalls++; return original(129); })).rejects.toThrow('容量');
  expect(overflowCalls).toBe(0); finishers.forEach((finish) => finish()); await Promise.all(writes);
  expect(buffer.pending()).toEqual(receipts);
  buffer.acknowledge(receipts[0]!); const next = original(129); await buffer.create(seed(next), async () => next); expect(buffer.pending()).toHaveLength(128);
});
test('unknown response or invalid actual material stays pending and cannot borrow a current UID or clear the reservation', async () => {
  const buffer = developmentAdmissionReceiptBuffer(), receipt = original(); let calls = 0;
  await expect(buffer.create(seed(receipt), async () => { calls++; throw new Error('actual response lost'); })).rejects.toThrow('lost');
  expect(buffer.pending()).toEqual([]);
  await expect(buffer.create(seed(receipt), async () => { calls++; return receipt; })).rejects.toThrow('原实际创建回执');
  expect(() => buffer.acknowledge(receipt)).toThrow(); expect(calls).toBe(1);
  const another = original(2);
  await expect(buffer.create(seed(another), async () => ({ ...another, intentHash: 'b'.repeat(64) }))).rejects.toThrow('原消费者材料');
  expect(buffer.pending()).toEqual([]);
});

test('precreate read failures release every reservation while issued creates with unknown responses still block reuse', async () => {
  const buffer = developmentAdmissionReceiptBuffer(); let creates = 0;
  const receipts = Array.from({ length: 128 }, (_, n) => original(n + 1));
  for (const receipt of receipts) await expect(buffer.create(seed(receipt), async () => { creates++; return receipt; }, async () => { throw new Error('temporary GET 503'); })).rejects.toThrow('503');
  expect(creates).toBe(0); expect(buffer.pending()).toEqual([]);
  for (const receipt of receipts) expect(await buffer.create(seed(receipt), async () => { creates++; return receipt; }, async () => false)).toEqual(receipt);
  expect(creates).toBe(128); expect(buffer.pending()).toEqual(receipts);
  await expect(buffer.create(seed(original(129)), async () => { creates++; return original(129); })).rejects.toThrow('容量'); expect(creates).toBe(128);
  buffer.acknowledge(receipts[0]!); const lost = original(129);
  await expect(buffer.create(seed(lost), async () => { creates++; throw new Error('create response lost'); }, async () => false)).rejects.toThrow('lost');
  await expect(buffer.create(seed(lost), async () => { creates++; return lost; }, async () => false)).rejects.toThrow('原实际创建回执'); expect(creates).toBe(129);
});
