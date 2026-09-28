import { expect, test } from 'bun:test';
import { ArchivePathSchema, OBJECT_STORAGE_LIMITS, StorageEndpointSchema } from './values';
import { AuthorizeObjectStoragePlansSchema, CreateObjectUploadSchema, ObjectReferenceSchema, ObjectStoragePlanInputSchema, RegisterObjectBackendSchema } from './requests';
import { ObjectBackendDtoSchema, StoredObjectDtoSchema } from './responses';
import { ObjectStorageObservationSchema } from './observations';

const id = '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', sha256 = 'a'.repeat(64), at = '2026-09-28T00:00:00.000Z';
const upload = { requestKey: 'upload', name: '产物.txt', size: 0, sha256 };

test('上传大小与摘要受严格边界约束，空对象合法且不允许覆盖物理 key', () => {
  expect(CreateObjectUploadSchema.parse(upload)).toMatchObject({ size: 0, mediaType: 'application/octet-stream' });
  expect(CreateObjectUploadSchema.safeParse({ ...upload, size: OBJECT_STORAGE_LIMITS.objectBytes }).success).toBe(true);
  for (const bad of [{ size: -1 }, { size: 1.5 }, { size: OBJECT_STORAGE_LIMITS.objectBytes + 1 }, { sha256: sha256.toUpperCase() }, { name: 'bad\r\nheader' }, { key: 'other-project/file' }]) {
    expect(CreateObjectUploadSchema.safeParse({ ...upload, ...bad }).success).toBe(false);
  }
});

test('服务不能伪造平台任务、收据或终结保护引用', () => {
  const input = { requestKey: 'pin', ownerType: 'application', ownerId: 'plugin/v1', revision: 1 };
  expect(ObjectReferenceSchema.safeParse(input).success).toBe(true);
  for (const ownerType of ['task', 'archive-pending', 'archive-receipt', 'finalization-guard']) expect(ObjectReferenceSchema.safeParse({ ...input, ownerType }).success).toBe(false);
});

test('后端端点不能携带凭据、改写路径、查询或非 HTTP 协议', () => {
  expect(StorageEndpointSchema.parse('http://garage.crewstation-system.svc:3900')).toContain('garage');
  for (const endpoint of ['file:///etc/passwd', 'https://user:secret@store.test', 'https://store.test/other', 'https://store.test/?key=value', 'https://store.test/#fragment']) expect(StorageEndpointSchema.safeParse(endpoint).success).toBe(false);
  const registered = RegisterObjectBackendSchema.parse({ requestKey: 'backend', name: '本机 Garage', endpoint: 'http://garage:3900', bucket: 'crewstation-objects', accessKeyId: 'id', secretAccessKey: 'secret', durability: 'dev-only' });
  expect(registered).toMatchObject({ region: 'garage', budgetBytes: 60 * 1024 ** 3 });
  expect(RegisterObjectBackendSchema.safeParse({ ...registered, bucket: 'other..bucket' }).success).toBe(false);
});

test('档位不超出单对象和空间边界，项目授权没有重复项', () => {
  expect(ObjectStoragePlanInputSchema.parse({ name: '标准', backendId: id })).toMatchObject({ quotaBytes: 20 * 1024 ** 3, maxConcurrentTransfers: 4, enabled: true });
  expect(ObjectStoragePlanInputSchema.safeParse({ name: '小', backendId: id, quotaBytes: 2, maxObjectBytes: 3 }).success).toBe(false);
  expect(AuthorizeObjectStoragePlansSchema.safeParse({ projectId: id, expectedRevision: 1, planIds: [id, id] }).success).toBe(false);
});

test('归档路径拒绝越界、私有目录、通配符和超过 UTF8 字节上限的名字', () => {
  expect(ArchivePathSchema.parse('reports/结果.json')).toBe('reports/结果.json');
  for (const value of ['/work/x', '../x', 'a/../x', 'a//x', 'a/./x', 'a\\b', '.crewstation/secret', 'a/*', 'a/[01]', 'C:/x', '中'.repeat(342)]) expect(ArchivePathSchema.safeParse(value).success).toBe(false);
});

test('对象和后端响应不接受物理 key 或明文凭据', () => {
  const object = { id, spaceId: id, revision: 1, name: 'x', size: 0, sha256, mediaType: 'text/plain', state: 'ready', referenceCount: 1, createdAt: at, verifiedAt: at, message: null };
  expect(StoredObjectDtoSchema.safeParse(object).success).toBe(true);
  expect(StoredObjectDtoSchema.safeParse({ ...object, key: 'private-key' }).success).toBe(false);
  const backend = { id, name: 'x', endpoint: 'http://garage:3900', bucket: 'crewstation-objects', region: 'garage', revision: 1, placementRevision: 1, credentialRevision: 1, state: 'active', health: 'unknown', durability: 'dev-only', durabilityVerifiedAt: null, budgetBytes: 1, reservedBytes: 0, physicalFreeBytes: null, physicalTotalBytes: null, observedAt: null, message: null, createdAt: at };
  expect(ObjectBackendDtoSchema.safeParse(backend).success).toBe(true);
  expect(ObjectBackendDtoSchema.safeParse({ ...backend, secretAccessKey: 'secret' }).success).toBe(false);
});

test('可观测响应保留未知与真实零的区别，并限制错误率范围', () => {
  const sample = { at, readBytesPerSecond: null, writeBytesPerSecond: 0, requestsPerSecond: null, errorRatio: null, p95Seconds: null };
  const input = { backendId: id, spaceId: null, health: 'unknown', window: '1h', observedAt: null, stale: true, unavailableReason: 'not-observed', logical: { usedBytes: 0, reservedBytes: 0, deletingBytes: 0, quotaBytes: 1 }, physical: { freeBytes: null, totalBytes: null, observedAt: null }, queue: { uploading: 0, verifying: 0, deleting: 0, failed: 0, unknownWrites: 0, activeDownloads: 0, unknownDownloads: 0, pendingBytes: 0, oldestPendingAt: null }, samples: [sample], blockers: [], blockersNextCursor: null, lastBackupAt: null };
  expect(ObjectStorageObservationSchema.parse(input).samples[0]).toEqual(sample);
  expect(ObjectStorageObservationSchema.safeParse({ ...input, samples: [{ ...sample, errorRatio: 2 }] }).success).toBe(false);
});
