import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BuildKitCacheRecordSchema } from '../metadata';

export const nativeHash = z.string().regex(/^[a-f0-9]{64}$/), nativeId = z.string().regex(/^[a-z0-9]{20,40}$/);
export const nativeDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/), storageId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const component = z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,252}$/);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
export const BuildKitInventoryRequestSchema = z.strictObject({ key: z.string().min(1).max(200), rootId: z.string().min(1).max(50), directory: component,
  storageIds: z.array(storageId).max(1000).refine(unique), contentDigests: z.array(nativeDigest).max(10_000).refine(unique) });
export type BuildKitInventoryRequest = z.infer<typeof BuildKitInventoryRequestSchema>;
export const buildKitInventoryRequestIdentity = (raw: BuildKitInventoryRequest) => createHash('sha256').update(JSON.stringify(BuildKitInventoryRequestSchema.parse(raw))).digest('hex');
const label = z.strictObject({ identity: nativeHash, content: z.array(nativeDigest), snapshots: z.array(z.string()) });
export const BuildKitContainerdGraphSchema = z.strictObject({ version: z.literal('containerd-buildkit/v1'), complete: z.literal(true), revision: nativeHash, physicalReclamationProven: z.literal(false), ingests: z.number().int().nonnegative(),
  content: z.array(z.strictObject({ namespace: z.enum(['buildkit', 'buildkit_history']), digest: nativeDigest, created: z.string().regex(/^01[a-f0-9]{28}$/), updated: z.string().regex(/^01[a-f0-9]{28}$/), size: z.number().int().nonnegative(), labels: label })),
  leases: z.array(z.strictObject({ namespace: z.enum(['buildkit', 'buildkit_history']), kind: z.enum(['cache', 'history', 'other']), id: z.string(), created: z.string().regex(/^01[a-f0-9]{28}$/), labelsIdentity: nativeHash, content: z.array(nativeDigest), snapshots: z.array(z.string()), ingests: z.number().int().nonnegative() })),
  snapshots: z.array(z.strictObject({ id: z.string(), name: z.string(), created: z.string().regex(/^01[a-f0-9]{28}$/), updated: z.string().regex(/^01[a-f0-9]{28}$/), parent: z.string().optional(), children: z.array(z.string()), labels: label })),
  unresolvedSnapshots: z.array(z.strictObject({ source: z.string(), target: z.string(), kind: z.enum(['parent', 'child']) })),
});
const resultKey = z.union([nativeId, nativeDigest, z.string().regex(/^random:[a-f0-9]{64}$/)]), decimal = z.string().regex(/^[0-9]+$/);
export const BuildKitResultGraphSchema = z.strictObject({ version: z.literal('buildkit/0.33.0'), complete: z.literal(true), revision: nativeHash, keys: z.array(resultKey),
  results: z.array(z.strictObject({ key: resultKey, workerId: nativeId, cacheId: nativeId, createdAt: z.iso.datetime() })),
  links: z.array(z.strictObject({ source: resultKey, target: resultKey, input: z.number().int().nonnegative(), output: z.number().int().nonnegative(), digest: nativeDigest, selector: nativeDigest.optional() })),
});
export const BuildKitSnapshotGraphSchema = z.strictObject({ version: z.literal('containerd-overlayfs/v1'), complete: z.literal(true), revision: nativeHash,
  records: z.array(z.strictObject({ key: z.string(), snapshot: z.string(), storageId, kind: z.number().int().min(1).max(3), created: z.string().regex(/^01[a-f0-9]{28}$/), parent: z.string().optional() })) });
export const BuildKitNativeFileSchema = z.strictObject({ path: z.string().min(1).max(4096), kind: z.enum(['file', 'directory', 'symlink', 'whiteout']), identity: nativeHash,
  device: decimal, inode: z.string().regex(/^[1-9][0-9]*$/), birthtimeNs: z.string().regex(/^[1-9][0-9]*$/), bytes: z.number().int().nonnegative(), allocatedBytes: z.number().int().nonnegative(), links: z.number().int().positive() });
export const BuildKitCacheGraphSchema = z.strictObject({ version: z.literal('buildkit/0.33.0'), complete: z.literal(true), revision: nativeHash, graphIdentity: nativeHash, records: z.array(BuildKitCacheRecordSchema) });
export const BuildKitInventoryResponseSchema = z.strictObject({ key: z.string(), requestIdentity: nativeHash, version: z.literal('buildkit-native-files/1'), complete: z.literal(true),
  rootIdentity: nativeHash, volumeIdentity: nativeHash, workerId: nativeId, observedAt: z.iso.datetime(), revision: nativeHash,
  databases: z.array(z.strictObject({ path: z.enum(['cache.db', 'runc-overlayfs/metadata_v2.db', 'runc-overlayfs/snapshots/metadata.db', 'runc-overlayfs/containerdmeta.db']), identity: nativeHash, revision: nativeHash })),
  cache: BuildKitCacheGraphSchema,
  results: BuildKitResultGraphSchema, snapshots: BuildKitSnapshotGraphSchema, containerd: BuildKitContainerdGraphSchema,
  allStorageIds: z.array(storageId).refine(unique), allContentDigests: z.array(nativeDigest).refine(unique),
  files: z.array(BuildKitNativeFileSchema).max(200_000), absentStorageIds: z.array(storageId), absentContent: z.array(nativeDigest),
  physicalReclamationProven: z.literal(false), producersClosed: z.literal(false), consumersStopped: z.literal(false),
});
export type BuildKitInventoryResponse = z.infer<typeof BuildKitInventoryResponseSchema>;
const databases = ['cache.db', 'runc-overlayfs/metadata_v2.db', 'runc-overlayfs/snapshots/metadata.db', 'runc-overlayfs/containerdmeta.db'];
/** Bind the entire selected tree and every original database, not just a
 * successful HTTP status or a caller's zero counters. */
export function validateBuildKitInventoryQuery(input: BuildKitInventoryRequest, result: BuildKitInventoryResponse) {
  const paths = result.files.map(row => row.path), dbPaths = result.databases.map(row => row.path);
  if (result.key !== input.key || result.requestIdentity !== buildKitInventoryRequestIdentity(input) || !unique(paths) || !unique(dbPaths)
    || dbPaths.length !== databases.length || databases.some(path => !dbPaths.includes(path as typeof dbPaths[number]))) throw Error('Native BuildKit original query or database EOF changed');
  for (const file of result.files) {
    const parts = file.path.split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || /[\0]/.test(part))) throw Error('Native BuildKit physical path is unsupported');
    if (parts[0] === 'snapshots') {
      if (!input.storageIds.includes(parts[1]!) || parts.length === 2 && file.kind !== 'directory') throw Error('Native BuildKit snapshot file is outside the original query');
    } else if (parts[0] !== 'content' || parts.length !== 2 || file.kind !== 'file' || !input.contentDigests.includes('sha256:' + parts[1])) throw Error('Native BuildKit content file is outside the original query');
  }
  if (!unique(result.absentStorageIds) || !unique(result.absentContent)
    || result.absentStorageIds.some(id => !input.storageIds.includes(id)) || result.absentContent.some(digest => !input.contentDigests.includes(digest))
    || input.storageIds.some(id => Number(paths.includes('snapshots/' + id)) + Number(result.absentStorageIds.includes(id)) !== 1)
    || input.contentDigests.some(digest => Number(paths.includes('content/' + digest.slice(7))) + Number(result.absentContent.includes(digest)) !== 1)) throw Error('Native BuildKit complete physical selection has a missing, repeated or substituted identity');
  return result;
}
