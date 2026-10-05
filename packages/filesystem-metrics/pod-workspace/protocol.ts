import { z } from 'zod';
const hash = z.string().regex(/^[a-f0-9]{64}$/), name = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
// Kubelet stores static Pods under their config hash, while ordinary Pods
// use their API UUID. Both are native identities in the full node catalog.
export const KubeletPodIdentitySchema = z.union([z.uuid(), z.string().regex(/^[a-f0-9]{32}$/)]);
export const PodWorkspaceRequestSchema = z.strictObject({ key: z.string().min(1).max(200), podUid: z.uuid(), volumes: z.array(name).max(64) })
  .refine(input => new Set(input.volumes).size === input.volumes.length);
export const PodWorkspaceResponseSchema = z.strictObject({ version: z.literal(1), key: z.string(), podUid: z.uuid(), rootIdentity: hash,
  podIdentity: hash.nullable(), allPodUids: z.array(KubeletPodIdentitySchema), volumes: z.array(z.strictObject({ name, identity: hash.nullable(), files: z.array(z.strictObject({
    path: z.string().max(8192), kind: z.enum(['directory', 'file', 'symlink', 'socket', 'fifo', 'whiteout']), identity: hash,
    device: z.string().regex(/^[0-9]+$/), inode: z.string().regex(/^[1-9][0-9]*$/), birthtimeNs: z.string().regex(/^[1-9][0-9]*$/),
    bytes: z.number().int().nonnegative(), allocatedBytes: z.number().int().nonnegative(), links: z.number().int().positive(),
  })) })), complete: z.literal(true), revision: hash, observedAt: z.iso.datetime(), physicalReclamationProven: z.literal(false),
}).refine(input => new Set(input.allPodUids).size === input.allPodUids.length && new Set(input.volumes.map(row => row.name)).size === input.volumes.length);
export type PodWorkspaceRequest = z.infer<typeof PodWorkspaceRequestSchema>;
export type PodWorkspaceResponse = z.infer<typeof PodWorkspaceResponseSchema>;
