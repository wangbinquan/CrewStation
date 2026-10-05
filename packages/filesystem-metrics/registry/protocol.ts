import { z } from 'zod';
import {createHash} from 'node:crypto';

const repository = z.string().min(1).max(255).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identity = z.string().regex(/^[a-f0-9]{64}$/);
const fileIdentity={identity,bytes:z.number().int().nonnegative(),allocatedBytes:z.number().int().nonnegative(),device:z.string().regex(/^[0-9]+$/),inode:z.string().regex(/^[1-9][0-9]*$/),birthtimeNs:z.string().regex(/^[1-9][0-9]*$/)};
export const RegistryInventoryRequestSchema = z.strictObject({
  key: z.string().min(1).max(200), rootId: z.string().min(1).max(50), directory: z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,252}$/),
  exact: z.array(repository).max(128), prefixes: z.array(repository).max(128), retainedDigests: z.array(digest).max(10_000), retainedManifests: z.array(digest).max(10_000),
  /** Independent platform catalog pins can share a repository within a project prefix. */
  protectedRepositories: z.array(repository).max(10_000).optional(),
}).refine(value => value.exact.length + value.prefixes.length > 0
  && new Set(value.exact).size === value.exact.length && new Set(value.prefixes).size === value.prefixes.length
  && new Set(value.retainedDigests).size === value.retainedDigests.length && new Set(value.retainedManifests).size === value.retainedManifests.length
  && (!value.protectedRepositories || new Set(value.protectedRepositories).size === value.protectedRepositories.length));
export const RegistryInventoryResponseSchema = z.strictObject({
  key: z.string(), requestIdentity:identity, layout: z.literal('distribution-filesystem/v2'), rootIdentity: identity, volumeIdentity: identity,
  revision: identity, complete: z.literal(true), observedAt: z.string().datetime(),
  repositories: z.array(z.string()),
  entries: z.array(z.strictObject({ path: z.string(), kind: z.enum(['file','directory']), ...fileIdentity })),
  blobs: z.array(z.strictObject({ digest, path: z.string(), ...fileIdentity, otherRepositories: z.array(z.string()) })),
  retainedAbsent: z.array(digest),
});
export type RegistryInventoryRequest = z.infer<typeof RegistryInventoryRequestSchema>;
export type RegistryInventoryResponse = z.infer<typeof RegistryInventoryResponseSchema>;
export const registryRequestIdentity=(input:RegistryInventoryRequest)=>createHash('sha256').update(JSON.stringify(RegistryInventoryRequestSchema.parse(input))).digest('hex');
