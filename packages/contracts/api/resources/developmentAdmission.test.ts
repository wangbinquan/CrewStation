// RFC-034: original admission evidence cannot be issued for business/legacy consumers or an unknown UID.
import { expect, test } from 'bun:test';
import { DevelopmentAdmissionReceiptSchema, DevelopmentAdmissionStateSchema, DevelopmentRemovalProtectionSchema } from './developmentAdmission';

const id = (n: number) => '019f0000-0000-7000-8000-' + String(n).padStart(12, '0');
const receipt = () => ({ version: 1, consumer: { id: id(1), resourceId: id(2), taskId: id(3), namespace: 'cs-receipt', podName: 'original-agent', revision: 1, purpose: 'agent', finalization: null, volumeUid: crypto.randomUUID() },
  permit: { podUid: crypto.randomUUID(), nodeName: 'original-node', nodeUid: crypto.randomUUID() }, intentHash: 'a'.repeat(64), secretUid: crypto.randomUUID() });
test('strict new selection and null original state do not accept extra data, unsupported versions or fabricated identity', () => {
  expect(DevelopmentRemovalProtectionSchema.parse({ version: 1 })).toEqual({ version: 1 });
  expect(DevelopmentAdmissionStateSchema.parse({ version: 1, intentHash: 'a'.repeat(64), secretUid: null }).secretUid).toBeNull();
  for (const value of [null, { version: 2 }, { version: 1, extra: true }]) expect(DevelopmentRemovalProtectionSchema.safeParse(value).success).toBe(false);
  for (const patch of [{ intentHash: 'unknown' }, { secretUid: '' }, { secretUid: 'same-name' }, { extra: true }]) expect(DevelopmentAdmissionStateSchema.safeParse({ version: 1, intentHash: 'a'.repeat(64), secretUid: null, ...patch }).success).toBe(false);
});
test('only a valid actual Secret UUID, original four-tuple and independent Agent are accepted', () => {
  const original = receipt(); expect<unknown>(DevelopmentAdmissionReceiptSchema.parse(original)).toEqual(original);
  for (const patch of [
    { secretUid: null }, { secretUid: 'current-object' }, { intentHash: '' }, { version: 2 }, { token: 'must-not-retain' },
    { consumer: { ...original.consumer, purpose: 'business' } }, { consumer: { ...original.consumer, resourceId: original.consumer.taskId } },
    { permit: { ...original.permit, podUid: 'unknown' } }, { permit: { ...original.permit, nodeUid: 'unknown' } },
  ]) expect(DevelopmentAdmissionReceiptSchema.safeParse({ ...original, ...patch }).success).toBe(false);
});
