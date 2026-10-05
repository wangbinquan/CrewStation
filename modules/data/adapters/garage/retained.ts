import { GarageInventoryResponseSchema } from '@crewstation/filesystem-metrics';
import type { GarageInventoryRequest, GarageInventoryResponse } from '@crewstation/filesystem-metrics';
import { jsonHash, precondition } from '@crewstation/kernel';
import { z } from 'zod';
import type { DataDeletionScope } from '../../ports/deletion/projectDeletion';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const GarageConsumerOriginSchema = z.strictObject({ identity: hash, probeUid: z.uuid(), containerId: z.string(), imageId: z.string(), nodeUid: z.uuid(), nodeName: z.string(), bootId: z.uuid(), namespace: z.string() });
export type GarageConsumerOrigin = z.infer<typeof GarageConsumerOriginSchema>;
export interface GarageObservation {
  identity: string;
  origin: { nodeUid: string; nodeName: string; [key: string]: unknown };
  inventory: GarageInventoryResponse;
}
export type GarageQuery = GarageInventoryRequest['query'];
export interface GarageNativeSource {
  capture(query: GarageQuery, signal?: AbortSignal): Promise<GarageObservation>;
  verify(query: GarageQuery, original: { identity: string }, signal?: AbortSignal): Promise<GarageObservation>;
}
export interface GarageConsumerSource {
  capture(node: { uid: string; name: string }, files: Array<{ device: string; inode: string }>): Promise<{ source: GarageConsumerOrigin; complete: true; count: number; digest: string }>;
  observe(source: GarageConsumerOrigin, files: Array<{ device: string; inode: string }>): Promise<{ source: GarageConsumerOrigin; complete: true; count: number; digest: string }>;
}
const placement = z.strictObject({ backendId: z.uuid(), placementRevision: z.number().int().positive() });
const group = z.strictObject({ query: z.strictObject({ bucketId: hash, spaceIds: z.array(z.uuid()).min(1), retainedVersions: z.array(hash), retainedUploads: z.array(hash), retainedBlocks: z.array(hash) }),
  identity: hash, origin: z.json(), node: hash, bucketCreated: z.string().datetime(), placements: z.array(placement).min(1),
  files: z.array(GarageInventoryResponseSchema.shape.blocks.shape.copies.element), consumers: GarageConsumerOriginSchema });
export const GarageDeletionHistorySchema = z.strictObject({ version: z.literal(1), projectId: z.uuid(), groups: z.array(group) });
export type GarageDeletionHistory = z.infer<typeof GarageDeletionHistorySchema>;
export type GarageDeletionGroup = GarageDeletionHistory['groups'][number];

export function retainedGarageHistory(scope: DataDeletionScope): GarageDeletionHistory | undefined {
  if (!scope.nativeHistory) return undefined;
  if (scope.nativeHistory.digest !== jsonHash(scope.nativeHistory.body)) throw precondition('Garage 原物理材料摘要不符');
  const history = GarageDeletionHistorySchema.parse(scope.nativeHistory.body);
  if (scope.nativeHistory.identity !== garageHistoryIdentity(history)) throw precondition('Garage 原来源身份不符');
  return history;
}
export function garageHistoryIdentity(history: GarageDeletionHistory): string {
  return jsonHash({ projectId: history.projectId, sources: history.groups.map(row => ({ bucket: row.query.bucketId, identity: row.identity, node: row.node, bucketCreated: row.bucketCreated, placements: row.placements })) });
}
export function bindGarageObservation(original: GarageDeletionGroup, current: GarageObservation) {
  if (current.identity !== original.identity || jsonHash(current.origin) !== jsonHash(original.origin)) throw precondition('Garage 原软件实例或卷被替换');
  const known = new Set(original.query.retainedVersions), uploads = new Set(original.query.retainedUploads), blocks = new Set(original.query.retainedBlocks);
  const metadata = current.inventory.metadata;
  const liveNewVersion = metadata.objects.some(object => object.versions.some(version => !known.has(version.id) && !['deleted', 'aborted'].includes(version.state)))
    || metadata.rows.some(row => row.family === 'version' && !known.has(row.id) && !row.deleted);
  if (liveNewVersion || metadata.multipart.some(upload => !uploads.has(upload.id) && !upload.deleted)
    || metadata.blocks.some(id => !blocks.has(id))) throw precondition('Garage 原确认后出现新的版本或块，需要重新盘点确认');
  const files = new Map(original.files.map(file => [file.path, file]));
  for (const actual of current.inventory.blocks.copies) if (files.get(actual.path)?.identity !== actual.identity) throw precondition('Garage 原块副本出生已变化');
}
export function garageRemaining(inventory: GarageInventoryResponse) {
  // Vendor tombstones contain no object payload. Pending insert rows are also
  // included, so a queued old payload cannot be mistaken for a final absence.
  const metadata = inventory.metadata;
  const native = metadata.objects.reduce((sum, object) => sum + object.versions.filter(version => !['deleted', 'aborted'].includes(version.state)).length, 0)
    + metadata.multipart.filter(row => !row.deleted).length
    + metadata.rows.filter(row => row.family === 'version' && !row.deleted).length
    + metadata.references.filter(row => row.owned && !row.deleted).length;
  const shared = new Set(metadata.references.filter(row => !row.owned && !row.deleted).map(row => row.block));
  const storage = inventory.blocks.copies.filter(file => !shared.has(file.hash));
  return { native, storage: storage.length, shared, bytes: storage.reduce((sum, file) => sum + file.allocatedBytes, 0) };
}
