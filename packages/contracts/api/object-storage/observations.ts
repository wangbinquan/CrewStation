import { z } from 'zod';
import { ResourceIdSchema, TaskIdSchema } from '../../ids';
import { StorageBytesSchema, StorageHealthSchema, StorageWindowSchema } from './values';
import { ObjectBackupObservationSchema } from './backups';

/** Null means not measured; zero is reserved for a successful observation with no activity. */
const measured = z.number().finite().nonnegative().nullable();
export const ObjectStorageSampleSchema = z.strictObject({
  at: z.iso.datetime(), readBytesPerSecond: measured, writeBytesPerSecond: measured,
  requestsPerSecond: measured, errorRatio: z.number().min(0).max(1).nullable(), p95Seconds: measured,
});
export const ObjectStorageQueueSchema = z.strictObject({
  uploading: StorageBytesSchema, verifying: StorageBytesSchema, deleting: StorageBytesSchema,
  failed: StorageBytesSchema, unknownWrites: StorageBytesSchema,
  activeDownloads: StorageBytesSchema, unknownDownloads: StorageBytesSchema,
  pendingBytes: StorageBytesSchema, oldestPendingAt: z.iso.datetime().nullable(),
});
export const ObjectStorageBlockerSchema = z.strictObject({
  taskId: TaskIdSchema, operationId: ResourceIdSchema, phase: z.string(), code: z.string(), message: z.string(), since: z.iso.datetime(),
});
export const ObjectStorageBlockerPageSchema = z.strictObject({ items: z.array(ObjectStorageBlockerSchema).max(100), nextCursor: ResourceIdSchema.nullable() });
export const ObjectStorageObservationSchema = z.strictObject({
  backendId: ResourceIdSchema, spaceId: ResourceIdSchema.nullable(), health: StorageHealthSchema,
  window: StorageWindowSchema, observedAt: z.iso.datetime().nullable(), stale: z.boolean(), unavailableReason: z.string().nullable(),
  logical: z.strictObject({ usedBytes: StorageBytesSchema, reservedBytes: StorageBytesSchema, deletingBytes: StorageBytesSchema, quotaBytes: StorageBytesSchema }),
  physical: z.strictObject({ freeBytes: StorageBytesSchema.nullable(), totalBytes: StorageBytesSchema.nullable(), observedAt: z.iso.datetime().nullable() }),
  queue: ObjectStorageQueueSchema, samples: z.array(ObjectStorageSampleSchema).max(1024),
  blockers: z.array(ObjectStorageBlockerSchema).max(100), blockersNextCursor: z.string().nullable(),
  lastBackupAt: z.iso.datetime().nullable(),
  backup: ObjectBackupObservationSchema.nullable().optional(),
});

export type ObjectStorageSample = z.infer<typeof ObjectStorageSampleSchema>;
export type ObjectStorageQueue = z.infer<typeof ObjectStorageQueueSchema>;
export type ObjectStorageBlocker = z.infer<typeof ObjectStorageBlockerSchema>;
export type ObjectStorageBlockerPage = z.infer<typeof ObjectStorageBlockerPageSchema>;
export type ObjectStorageObservation = z.infer<typeof ObjectStorageObservationSchema>;
export const ObjectArchiveHistoryItemSchema = z.strictObject({
  operationId: ResourceIdSchema, taskId: TaskIdSchema, revision: z.number().int().positive(),
  state: z.enum(['prepared', 'bound', 'receipted', 'delete-started', 'completed', 'aborted']),
  receiptId: ResourceIdSchema.nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
export const ObjectArchiveHistoryPageSchema = z.strictObject({ items: z.array(ObjectArchiveHistoryItemSchema).max(100), nextCursor: ResourceIdSchema.nullable() });
export type ObjectArchiveHistoryItem = z.infer<typeof ObjectArchiveHistoryItemSchema>;
export type ObjectArchiveHistoryPage = z.infer<typeof ObjectArchiveHistoryPageSchema>;
