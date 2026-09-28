import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { FinalizationArchiveSchema } from '../business/finalization';
import { ArchiveLossPageQuerySchema } from './loss';
import { ArchivePlanEntrySchema } from './archivePlans';
import { StorageRevisionSchema } from './values';

export const ArchiveRevisionPreviewRequestSchema = ArchiveLossPageQuerySchema.extend({ expectedRevision: StorageRevisionSchema, archive: FinalizationArchiveSchema });
export const ArchiveRevisionPreviewSchema = z.strictObject({
  operationId: ResourceIdSchema, revision: StorageRevisionSchema, taskGeneration: StorageRevisionSchema, volumeUid: z.string().nullable(),
  oldCount: z.number().int().nonnegative(), newCount: z.number().int().nonnegative(), discardedCount: z.number().int().nonnegative(),
  discarded: z.array(ArchivePlanEntrySchema).max(100), nextOffset: z.number().int().nonnegative().nullable(),
});
export type ArchiveRevisionPreviewRequest = z.infer<typeof ArchiveRevisionPreviewRequestSchema>;
export type ArchiveRevisionPreview = z.infer<typeof ArchiveRevisionPreviewSchema>;
