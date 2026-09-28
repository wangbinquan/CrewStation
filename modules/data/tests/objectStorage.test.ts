import { describe, expect, test } from 'bun:test';
import type { BusinessExecutionFence, StoredObjectDto } from '@crewstation/contracts';
import { ObjectBackendDtoSchema, ObjectSpaceDtoSchema, StoredObjectDtoSchema } from '@crewstation/contracts';
import { backendFixture, controlFixture, objectId, sourceFixture, spaceFixture, storageNow } from './objectFixtures';
import { assertObjectAllocation, assertObjectDeletable, assertObjectReadable, assertPhysicalAttempt, assertSameStorageRequest, assertStorageRevision, assertStorageWrite, backendDto, spaceDto, storedObjectDto } from '../domain/objectStorage';

describe('object storage invariants', () => {
  test('leases fail closed for absent, expired, malformed or superseded authority', () => {
    const source = sourceFixture(), control = controlFixture(source.serviceId);
    const fence = { epoch: control.epoch, leaseId: control.leaseId, instanceId: control.instanceId } as BusinessExecutionFence;
    const now = new Date(storageNow);
    expect(() => assertStorageWrite(control, fence, true, now, source.podUid)).not.toThrow();
    expect(() => assertStorageWrite(control, fence, true, now, 'another-pod')).toThrow();
    expect(() => assertStorageWrite(undefined, undefined, false, now)).not.toThrow();
    for (const value of [undefined, { ...control, phase: 'frozen' as const }, { ...control, leaseUntil: storageNow }, { ...control, leaseUntil: 'invalid' }, { ...control, epoch: 2 }, { ...control, instanceId: objectId() }]) {
      expect(() => assertStorageWrite(value, fence, true, now, source.podUid)).toThrow();
    }
    expect(() => assertStorageWrite(control, undefined, false, now)).toThrow();
  });
  test('logical reservations include pending deletes and reject fractional or oversized files', () => {
    const space = spaceFixture(objectId(), sourceFixture(), { usedBytes: 200, reservedBytes: 300, deletingBytes: 400 });
    expect(() => assertObjectAllocation(space, 100)).not.toThrow();
    for (const size of [101, -1, 0.5, NaN, Infinity, 1001]) expect(() => assertObjectAllocation(space, size)).toThrow();
    expect(() => assertObjectAllocation({ ...space, enabled: false }, 0)).toThrow();
    expect(() => assertObjectAllocation({ ...space, health: 'unknown' }, 0)).toThrow();
  });
  test('attempts consume physical budget and shared service concurrency', () => {
    const backend = backendFixture({ health: 'ready', reservedBytes: 9900 });
    const space = spaceFixture(backend.id);
    expect(() => assertPhysicalAttempt(backend, space, 100)).not.toThrow();
    expect(() => assertPhysicalAttempt(backend, space, 101)).toThrow();
    expect(() => assertPhysicalAttempt({ ...backend, physicalFreeBytes: 0 }, space, 1)).toThrow();
    expect(() => assertPhysicalAttempt(backend, { ...space, activeTransfers: 4 }, 0)).toThrow();
  });
  test('DTOs remove placement keys, request digests, execution authority and internal controls', () => {
    const backend = backendFixture(), space = spaceFixture(backend.id);
    expect(ObjectBackendDtoSchema.parse(backendDto(backend))).not.toHaveProperty('requestDigest');
    expect(ObjectSpaceDtoSchema.parse(spaceDto(space))).not.toHaveProperty('enabled');
    const dto: StoredObjectDto = { id: objectId(), spaceId: space.id, name: 'result', revision: 1, size: 1, sha256: 'a'.repeat(64), mediaType: 'text/plain', state: 'ready', referenceCount: 0, createdAt: storageNow, verifiedAt: storageNow, message: null };
    const record = { ...dto, backendId: backend.id, placementRevision: 1, key: 'private', uploadId: objectId(), attemptId: objectId() };
    expect(StoredObjectDtoSchema.parse(storedObjectDto(record))).toEqual(dto);
    expect(() => assertObjectReadable({ ...record, state: 'degraded' })).toThrow();
    expect(() => assertObjectDeletable(record, 1)).toThrow();
    expect(() => assertObjectDeletable(record, 0)).not.toThrow();
  });
  test('retries cannot silently change revisions or idempotent payloads', () => {
    expect(() => assertStorageRevision(2, 1)).toThrow();
    expect(() => assertSameStorageRequest('a', 'b')).toThrow();
  });
});
