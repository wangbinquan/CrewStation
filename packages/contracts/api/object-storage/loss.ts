import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { ArchiveReceiptItemSchema } from '../business/finalization';
import { ObjectDigestSchema, StorageRevisionSchema } from './values';

export const ArchiveLossPageQuerySchema = z.strictObject({ offset: z.coerce.number().int().min(0).max(10_000).default(0), limit: z.coerce.number().int().min(1).max(100).default(100) });
export const ArchiveLossItemSchema = z.strictObject({ item: ArchiveReceiptItemSchema, path: z.string().nullable(), sourceObjectId: ResourceIdSchema.nullable(), referenceCount: z.number().int().nonnegative().nullable() });
export const ArchiveLossAssessmentSchema = z.strictObject({
  operationId: ResourceIdSchema, revision: StorageRevisionSchema, volumeUid: z.string().nullable(), assessmentDigest: ObjectDigestSchema,
  items: z.array(ArchiveLossItemSchema), itemCount: z.number().int().nonnegative(), lostCount: z.number().int().nonnegative(), savedCount: z.number().int().nonnegative(), nextOffset: z.number().int().nullable(),
});
export const BusinessStorageLossAssessmentSchema = ArchiveLossAssessmentSchema.extend({ resultsIncomplete: z.boolean(), executionStopConfirmed: z.boolean() });
export type ArchiveLossPageQuery = z.infer<typeof ArchiveLossPageQuerySchema>;
export type ArchiveLossItem = z.infer<typeof ArchiveLossItemSchema>;
export type ArchiveLossAssessment = z.infer<typeof ArchiveLossAssessmentSchema>;
export type BusinessStorageLossAssessment = z.infer<typeof BusinessStorageLossAssessmentSchema>;
