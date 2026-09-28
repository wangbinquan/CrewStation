import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { ArchivePathSchema, ObjectDigestSchema, StorageBytesSchema, OBJECT_STORAGE_LIMITS } from './values';
import { ArchivePlanEntrySchema } from './archivePlans';

/** Private archive protocol; these fields do not authorize service-level object access. */
export const ArchiveHelperUploadSchema = z.strictObject({ path: ArchivePathSchema, size: StorageBytesSchema.max(OBJECT_STORAGE_LIMITS.objectBytes), sha256: ObjectDigestSchema });
export const ArchiveHelperResultSchema = z.union([
  z.strictObject({ path: ArchivePathSchema, objectId: ResourceIdSchema }),
  z.strictObject({ path: ArchivePathSchema, omitted: z.literal('not-found') }),
]);
export const ArchiveHelperPageSchema = z.strictObject({
  offset: z.coerce.number().int().min(0).max(OBJECT_STORAGE_LIMITS.archiveFiles).default(0),
  limit: z.coerce.number().int().min(1).max(OBJECT_STORAGE_LIMITS.pageItems).default(OBJECT_STORAGE_LIMITS.pageItems),
});
export const ArchiveHelperEntriesSchema = z.strictObject({ items: z.array(ArchivePlanEntrySchema).max(100), nextOffset: z.number().int().min(0).max(OBJECT_STORAGE_LIMITS.archiveFiles).nullable() });
export type ArchiveHelperUpload = z.infer<typeof ArchiveHelperUploadSchema>;
export type ArchiveHelperResult = z.infer<typeof ArchiveHelperResultSchema>;
export const ArchiveHelperFailureSchema = z.strictObject({
  code: z.enum(['archive_file_missing', 'archive_file_unsafe', 'archive_file_too_large', 'archive_file_changed', 'archive_file_size_mismatch', 'archive_upload_blocked', 'archive_transfer_failed']),
  path: ArchivePathSchema.nullable(),
});
export type ArchiveHelperFailure = z.infer<typeof ArchiveHelperFailureSchema>;
