import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { StorageBytesSchema } from './values';

/** Operational records never contain destination paths, endpoint credentials or object names. */
export const ObjectBackupRecordSchema = z.strictObject({
  id: ResourceIdSchema, state: z.enum(['draining', 'exporting', 'succeeded', 'failed', 'aborted', 'restore-verified', 'restored']),
  destination: z.string().min(1).max(120), reason: z.string().min(1).max(1000),
  startedAt: z.iso.datetime(), updatedAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable(),
  objectCount: StorageBytesSchema, bytes: StorageBytesSchema,
  manifestDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  errorCode: z.enum(['export_failed', 'operator_aborted']).nullable(),
});
export const ObjectBackupObservationSchema = z.strictObject({
  latest: ObjectBackupRecordSchema.nullable(), lastSucceededAt: z.iso.datetime().nullable(),
  lastRestoreVerifiedAt: z.iso.datetime().nullable(),
});
export type ObjectBackupRecord = z.infer<typeof ObjectBackupRecordSchema>;
export type ObjectBackupObservation = z.infer<typeof ObjectBackupObservationSchema>;
