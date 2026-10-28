import { z } from 'zod';
import { DatabaseMigrationDigestSchema as digest, DatabaseMigrationOperationIdSchema as operationId } from './databaseMigration';
const name = z.string().min(1).max(2048);
// Canonical base64 via one character class and a round trip. A grouped pattern such as /^(?:[A-Za-z0-9+/]{4})*…$/
// returns false on Bun 1.3.13 for valid strings past about 4 MB, which rejected every 4 MiB chunk AW writes (RFC-044 T9).
const bytes = z.string().refine((value) => {
  try { return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value) && btoa(atob(value)) === value; } catch { return false; }
}, '产物内容必须是规范 base64');
const requestKey = z.string().min(1).max(4096);
export const MigrationArtifactWriteSchema = z.strictObject({ operationId, name, digest, bytes, requestKey });
export const MigrationArtifactQuerySchema = z.strictObject({ operationId, name });
export const MigrationArtifactSchema = z.strictObject({ bytes, digest }).nullable();
export const MigrationArtifactWrittenSchema = z.strictObject({ digest, bytes: z.number().int().nonnegative() });
export const MigrationFreezeVerifySchema = z.strictObject({ operationId, reference: z.string().min(1), sourceGenerationId: z.string().min(1), writersStopped: z.boolean() });
export const MigrationFreezeVerifiedSchema = z.strictObject({ verified: z.boolean() });
export const MigrationPreparedSchema = z.strictObject({ operationId, generationId: z.string().regex(/^dbg_[a-f0-9]{32}$/), receiptDigest: digest, location: z.strictObject({ kind: z.literal('postgresql-target'), profileRef: z.literal('crewstation:target') }), requestKey });
export const MigrationActivationQuerySchema = z.strictObject({ operationId });
export const MigrationActivationSchema = z.strictObject({ pointsAt: z.enum(['source','target','other','none']), pointerDigest: digest.nullable() });
export const MigrationRollbackSchema = z.strictObject({ requestKey });
export const MigrationBackupQuerySchema = z.strictObject({ reference: z.string().min(1) });
export const MigrationCallbackAckSchema = z.strictObject({});
export const MigrationCallbackErrorSchema = z.strictObject({ error: z.string(), message: z.string(), details: z.record(z.string(), z.json()) });
export type MigrationPrepared = z.infer<typeof MigrationPreparedSchema>;
