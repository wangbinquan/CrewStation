import { createHash } from 'node:crypto';
import { z } from 'zod';
import { GarageMetadataQuerySchema } from './metadata';

const id = z.string().regex(/^[a-f0-9]{64}$/), count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const directory = z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,252}$/);
const version = z.strictObject({ id, timestamp: count, state: z.enum(['aborted', 'deleted', 'uploading', 'inline', 'blocks']), bytes: count, blocks: z.array(id).max(100_000) });
export const GarageInventoryRequestSchema = z.strictObject({ key: z.string().min(1).max(200), rootId: z.string().min(1).max(50),
  metadataDirectory: directory, dataDirectory: directory, query: GarageMetadataQuerySchema });
export type GarageInventoryRequest = z.infer<typeof GarageInventoryRequestSchema>;
export const GarageInventoryResponseSchema = z.strictObject({ key: z.string(), requestIdentity: id, complete: z.literal(true),
  metadata: z.strictObject({ version: z.literal('garage-sqlite/2.4.1/v1'), observedAt: z.string().datetime(), readonly: z.literal(true),
    source: z.strictObject({ rootIdentity: id, volumeIdentity: id, databaseIdentity: id }), queryIdentity: id, revision: id,
    rows: z.array(z.strictObject({ family: z.enum(['object', 'version', 'multipart_upload', 'block_ref']), table: z.string(), key: z.string().regex(/^[a-f0-9]+$/), digest: id, id, deleted: z.boolean() })).max(800_000),
    objects: z.array(z.strictObject({ key: z.string(), versions: z.array(version).max(100_000) })).max(200_000),
    multipart: z.array(z.strictObject({ key: z.string(), id, deleted: z.boolean() })).max(200_000),
    versions: z.array(id).max(100_000), uploads: z.array(id).max(100_000), blocks: z.array(id).max(100_000),
    references: z.array(z.strictObject({ block: id, version: id, deleted: z.boolean(), owned: z.boolean() })).max(200_000),
    physicalReclamationProven: z.literal(false), producersClosed: z.literal(false), consumersStopped: z.literal(false) }),
  blocks: z.strictObject({ rootIdentity: id, volumeIdentity: id, readonly: z.literal(true), complete: z.literal(true),
    observedAt: z.string().datetime(), scanned: count, revision: id,
    copies: z.array(z.strictObject({ hash: id, path: z.string().min(1).max(4096), identity: id, bytes: count, allocatedBytes: count,
      device: z.string().regex(/^[0-9]+$/), inode: z.string().regex(/^[1-9][0-9]*$/), birthtimeNs: z.string().regex(/^[1-9][0-9]*$/) })).max(100_000) }) });
export type GarageInventoryResponse = z.infer<typeof GarageInventoryResponseSchema>;
export const garageRequestIdentity = (input: GarageInventoryRequest) => createHash('sha256').update(JSON.stringify(GarageInventoryRequestSchema.parse(input))).digest('hex');
