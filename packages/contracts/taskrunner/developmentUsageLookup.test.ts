import { expect, test } from 'bun:test';
import { DevelopmentUsageLookupSchema, DevelopmentUsageRegistrationSchema, StoredDevelopmentUsageSchema } from './developmentUsageStorage';
const id = (n: number) => '01a00000-0000-7000-8000-' + String(n).padStart(12, '0');
const registration = DevelopmentUsageRegistrationSchema.parse({ runtimeTaskId: id(3), key: { executionId: id(3), journalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', incarnation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', payloadDigest: 'c'.repeat(64) },
  podUid: 'original-pod', identity: { sourceKind: 'development-agent', projectId: id(1), taskId: id(2), agentId: id(4), executionId: id(3), executionGeneration: 1 }, profileId: id(5), profileRevision: 2 });
const stored = StoredDevelopmentUsageSchema.parse({ registration, receipt: null, persistedThrough: 0, runnerAcknowledgedThrough: 0, sourceAcknowledgedThrough: 0, offeredThrough: 0,
  complete: false, drainReason: null, loss: null, closure: null });
test('lookup absence is explicit and carries no fabricated numeric completion or sensitive material', () => {
  const absent = { version: 1, runtimeTaskId: registration.runtimeTaskId, kind: 'absent' } as const;
  expect(DevelopmentUsageLookupSchema.parse(absent)).toEqual(absent);
  for (const patch of [{ persistedThrough: 0 }, { complete: true }, { closure: null }, { price: 0 }, { stored }, { prompt: 'private' }, { digestNonce: 'secret' }, { version: 2 }, { kind: 'unknown' }])
    expect(DevelopmentUsageLookupSchema.safeParse({ ...absent, ...patch }).success).toBe(false);
  expect(DevelopmentUsageLookupSchema.safeParse({ ...absent, runtimeTaskId: 'not-an-execution' }).success).toBe(false);
});
test('registered lookup retains the entire original stored header and requires the same actual execution', () => {
  const value = { version: 1, runtimeTaskId: registration.runtimeTaskId, kind: 'registered', stored } as const;
  expect(DevelopmentUsageLookupSchema.parse(value)).toEqual(value);
  for (const patch of [{ runtimeTaskId: id(6) }, { stored: { ...stored, persistedThrough: -1 } }, { stored: { ...stored, registration: { ...registration, profileRevision: 0 } } }, { stored: { ...stored, arbitrary: true } }, { arbitrary: true }])
    expect(DevelopmentUsageLookupSchema.safeParse({ ...value, ...patch }).success).toBe(false);
  expect(DevelopmentUsageLookupSchema.safeParse({ version: 1, runtimeTaskId: registration.runtimeTaskId, kind: 'registered' }).success).toBe(false);
});
