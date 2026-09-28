import { z } from 'zod';
import { ResourceIdSchema, UserIdSchema } from '../../ids';
import { StorageRequestKeySchema } from './values';

export const DeleteArchiveArtifactsSchema = z.strictObject({
  requestKey: StorageRequestKeySchema, expectedReceiptId: ResourceIdSchema, reason: z.string().trim().min(1).max(1024), confirmation: z.literal('delete'),
});
export const ArchiveArtifactDeletionSchema = z.strictObject({
  receiptId: ResourceIdSchema, deletedAt: z.string().datetime(), actorId: UserIdSchema, reason: z.string(),
  objectCount: z.number().int().nonnegative(), retainedObjectCount: z.number().int().nonnegative(),
});
export type DeleteArchiveArtifacts = z.infer<typeof DeleteArchiveArtifactsSchema>;
export type ArchiveArtifactDeletion = z.infer<typeof ArchiveArtifactDeletionSchema>;
