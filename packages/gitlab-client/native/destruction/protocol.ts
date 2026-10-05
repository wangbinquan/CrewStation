import { z } from 'zod';
import { jsonHash } from '@crewstation/kernel';
import { GITLAB_NATIVE_STORAGE_KINDS, GitLabNativeInventorySchema, GitLabNativeInstanceSchema } from '../protocol';
import { GitLabFenceRequestSchema } from '../fence/protocol';

const hash = z.string().regex(/^[a-f0-9]{64}$/), count = z.number().int().nonnegative();
/** The retained inventory survives parent deletion; callers cannot substitute a new path or actor. */
export const GitLabDestructionRequestSchema = z.strictObject({ mode: z.enum(['observe', 'destroy', 'purge']), original: GitLabNativeInventorySchema })
  .refine(value => [...value.original.credentials.tokens, ...value.original.credentials.users, ...value.original.credentials.memberships].every(row => row.createdAt !== null)
    && (value.mode === 'observe' || value.original.categories.every(category => category.objects.every(row => row.model !== 'LfsObject'
      || row.projectIds.every(id => id === value.original.project.id)))
      && GitLabFenceRequestSchema.safeParse({ project: { id: value.original.project.id, pathWithNamespace: value.original.project.pathWithNamespace,
        createdAt: value.original.project.createdAt, diskPath: value.original.project.diskPath, storage: value.original.project.storage },
      credentials: value.original.credentials }).success));
const facts = z.strictObject({ project: GitLabNativeInventorySchema.shape.project, parentRemaining: count,
  credentialsRemaining: count, pipelinesRemaining: count, foreignReferences: count,
  categories: z.array(z.strictObject({ kind: z.enum(GITLAB_NATIVE_STORAGE_KINDS), count, complete: z.literal(true) })).length(11),
  nativeRemaining: count,
});
export const GitLabDestructionReceiptSchema = facts.extend({ version: z.literal(1), requestDigest: hash, revision: hash,
  observedAt: z.iso.datetime({ offset: true }), runtime: GitLabNativeInventorySchema.shape.runtime,
  physicalReclamationProven: z.literal(false), producersClosed: z.literal(false), consumersStopped: z.literal(false),
}).refine(value => value.parentRemaining <= 1 && new Set(value.categories.map(row => row.kind)).size === 11
  && value.nativeRemaining === value.parentRemaining + value.credentialsRemaining + value.pipelinesRemaining + value.categories.reduce((sum, row) => sum + row.count, 0)
  && value.revision === jsonHash({ project: value.project, parentRemaining: value.parentRemaining, credentialsRemaining: value.credentialsRemaining,
    pipelinesRemaining: value.pipelinesRemaining, foreignReferences: value.foreignReferences, categories: value.categories, nativeRemaining: value.nativeRemaining }));
export const GitLabDestructionResponseSchema = z.strictObject({ before: GitLabNativeInstanceSchema, after: GitLabNativeInstanceSchema, receipt: GitLabDestructionReceiptSchema });
export type GitLabDestructionRequest = z.infer<typeof GitLabDestructionRequestSchema>;
export type GitLabDestructionReceipt = z.infer<typeof GitLabDestructionReceiptSchema>;
