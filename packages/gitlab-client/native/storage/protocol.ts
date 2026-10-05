import { z } from 'zod';
import { jsonHash } from '@crewstation/kernel';
import { GitLabNativeInventorySchema, GitLabNativeInstanceSchema } from '../protocol';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uint64 = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/).refine(value => BigInt(value) <= 18_446_744_073_709_551_615n);
const positive = uint64.refine(value => value !== '0');
const root = z.enum(['repository', 'lfs', 'upload', 'artifact', 'trace', 'package', 'secure-file']);
const relative = z.string().min(1).max(4096).refine(value => value.isWellFormed() && Buffer.byteLength(value) <= 4096
  && !/[\x00-\x1f\x7f]/.test(value) && value.split('/').length <= 48 && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'));
const location = z.strictObject({ key: z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/), root, relative, mode: z.enum(['file', 'tree']) });
export const GitLabStorageRequestSchema = z.strictObject({ locations: z.array(location).min(1).max(128) })
  .refine(value => new Set(value.locations.map(row => row.key)).size === value.locations.length);
export const GitLabStorageRootsSchema = GitLabNativeInventorySchema.shape.roots
  .refine(values => new Set(values.map(value => value.kind)).size === 7 && values.every(value => value.identity !== null));
const entry = z.strictObject({ path: relative, kind: z.enum(['file', 'directory']), device: uint64, inode: positive, birthtimeNs: positive, identity: hash,
  bytes: z.number().int().nonnegative(), allocatedBytes: z.number().int().nonnegative(), links: z.number().int().positive(),
  mtimeNs: uint64, ctimeNs: uint64, mode: z.number().int().nonnegative(),
}).refine(value => value.identity === jsonHash({ device: value.device, inode: value.inode, birthtimeNs: value.birthtimeNs, kind: value.kind }));
export const GitLabStorageInventorySchema = z.strictObject({ version: z.literal(1), readonly: z.literal(true), complete: z.literal(true),
  observedAt: z.iso.datetime({ offset: true }), requestDigest: hash, revision: hash, roots: GitLabStorageRootsSchema,
  locations: z.array(location.extend({ present: z.boolean(), entries: z.array(entry).max(100_000) })).min(1).max(128),
  runtime: GitLabNativeInventorySchema.shape.runtime,
  physicalReclamationProven: z.literal(false), producersClosed: z.literal(false), consumersStopped: z.literal(false),
}).refine(value => value.locations.reduce((count, row) => count + row.entries.length, 0) <= 100_000
  && new Set(value.locations.map(row => row.key)).size === value.locations.length
  && value.locations.every(row => new Set(row.entries.map(item => item.path)).size === row.entries.length
    && (row.present ? row.entries.some(item => item.path === row.relative && item.kind === (row.mode === 'tree' ? 'directory' : 'file')) : row.entries.length === 0)
    && row.entries.every(item => (item.path === row.relative || row.mode === 'tree' && item.path.startsWith(row.relative + '/'))
      && item.device === value.roots.find(binding => binding.kind === row.root)?.identity?.device))
  && value.revision === jsonHash({ roots: value.roots, locations: value.locations }));
export const GitLabStorageResponseSchema = z.strictObject({ before: GitLabNativeInstanceSchema, after: GitLabNativeInstanceSchema, inventory: GitLabStorageInventorySchema });
export type GitLabStorageRequest = z.infer<typeof GitLabStorageRequestSchema>;
export type GitLabStorageRoots = z.infer<typeof GitLabStorageRootsSchema>;
export type GitLabStorageInventory = z.infer<typeof GitLabStorageInventorySchema>;
