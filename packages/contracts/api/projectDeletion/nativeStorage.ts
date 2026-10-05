import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { ProjectDeletionBlockerSchema, ProjectDeletionDigestSchema } from './values';

/** All managed registry writers and catalog pin changes share this admission.
 * Reclamation holds it exclusively while rechecking foreign references. */
export const NATIVE_REGISTRY_ADMISSION = 'storage.registry-admission';

/** Internal independent storage bridge. Native material is validated by the
 * owning adapter and retained before any producer or metadata is removed. */
export interface NativeRegistryDeletionSource {
  capture(projectId: string, query: { exact: string[]; prefixes: string[]; retainedDigests: string[]; retainedManifests: string[]; protectedRepositories?: string[] }): Promise<unknown>;
  inspect(history: unknown): Promise<{ identity: string; sourceIdentity: string; native: number; storage: number; allocatedBytes: number; consumerCount: number; consumerDigest: string;
    inventory: unknown; independent: true; physicalReclamationProven: false }>;
}

/** Checked before a native effect, as well as when the owner records evidence. */
export const ProjectDeletionNativeProofSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('waiting'), reason: z.string().min(1).max(1000) }),
  z.strictObject({ kind: z.literal('blocked'), blockers: z.array(ProjectDeletionBlockerSchema).min(1) }),
  z.strictObject({ kind: z.literal('done'), digest: ProjectDeletionDigestSchema, scopeDigest: ProjectDeletionDigestSchema, sourceIdentity: ProjectDeletionDigestSchema,
    independent: z.boolean(), producersClosed: z.boolean(), consumersStopped: z.boolean(), nativeRemaining: z.number().int().nonnegative(), storageRemaining: z.number().int().nonnegative(),
    callbackExits: z.array(z.strictObject({ id: ResourceIdSchema, originalIdentity: ProjectDeletionDigestSchema, digest: ProjectDeletionDigestSchema })).refine(rows => new Set(rows.map(row => row.id)).size === rows.length) }),
]);
