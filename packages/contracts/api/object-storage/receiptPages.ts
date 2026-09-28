import { z } from 'zod';
import { ArchiveReceiptDtoSchema, ArchiveReceiptItemSchema } from '../business/finalization';
import { OBJECT_STORAGE_LIMITS } from './values';
import { ArchiveArtifactDeletionSchema } from './artifactDeletion';

export const ArchiveReceiptPageQuerySchema = z.strictObject({
  offset: z.coerce.number().int().min(0).max(OBJECT_STORAGE_LIMITS.archiveFiles).default(0),
  limit: z.coerce.number().int().min(1).max(OBJECT_STORAGE_LIMITS.pageItems).default(OBJECT_STORAGE_LIMITS.pageItems),
});
export const ArchiveReceiptPageSchema = z.strictObject({
  artifactsDeleted: ArchiveArtifactDeletionSchema.nullable().optional(),
  receipt: ArchiveReceiptDtoSchema, items: z.array(ArchiveReceiptItemSchema).max(OBJECT_STORAGE_LIMITS.pageItems), nextOffset: z.number().int().nonnegative().nullable(),
});
export type ArchiveReceiptPageQuery = z.infer<typeof ArchiveReceiptPageQuerySchema>;
export type ArchiveReceiptPage = z.infer<typeof ArchiveReceiptPageSchema>;
