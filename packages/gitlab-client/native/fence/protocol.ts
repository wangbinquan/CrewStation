import { z } from 'zod';
import { jsonHash } from '@crewstation/kernel';
import { GitLabNativeInventorySchema, GitLabNativeInstanceSchema } from '../protocol';

const inventory = GitLabNativeInventorySchema.shape;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const GitLabFenceProjectSchema = inventory.project.omit({ archived: true, registryEnabled: true });
export const GitLabFenceRequestSchema = z.strictObject({ project: GitLabFenceProjectSchema, credentials: inventory.credentials })
  .refine(value => [...value.credentials.tokens, ...value.credentials.users, ...value.credentials.memberships].every(row => row.createdAt !== null)
    && value.credentials.users.every(user => user.userType === 'project_bot')
    && value.credentials.memberships.every(row => row.type === 'ProjectMember' && row.sourceType === 'Project' && row.sourceId === value.project.id)
    && value.credentials.tokens.every(row => value.credentials.users.some(user => user.id === row.userId))
    && value.credentials.memberships.every(row => value.credentials.users.some(user => user.id === row.userId))
    && value.credentials.users.every(user => value.credentials.memberships.some(row => row.userId === user.id)));
export const GITLAB_FENCE_WRITE_PERMISSIONS = ['push_code', 'create_wiki', 'create_design', 'create_snippet', 'upload_file',
  'create_build', 'create_pipeline', 'create_package', 'create_container_image', 'admin_secure_files', 'create_resource_access_tokens'] as const;
const facts = z.strictObject({ project: GitLabFenceProjectSchema, pendingDelete: z.boolean(), deletionInProgress: z.boolean(),
  credentials: inventory.credentials, cancelablePipelines: z.number().int().nonnegative(),
  permissions: z.array(z.strictObject({ userId: z.string().regex(/^[1-9][0-9]*$/),
    allowed: z.array(z.enum(GITLAB_FENCE_WRITE_PERMISSIONS)).max(GITLAB_FENCE_WRITE_PERMISSIONS.length) })).max(100_001),
});
export const GitLabFenceReceiptSchema = facts.extend({ version: z.literal(1), requestDigest: hash, revision: hash,
  observedAt: z.iso.datetime({ offset: true }), runtime: inventory.runtime,
  physicalReclamationProven: z.literal(false), producersClosed: z.literal(false), consumersStopped: z.literal(false),
}).refine(value => value.revision === jsonHash({ project: value.project, pendingDelete: value.pendingDelete, deletionInProgress: value.deletionInProgress,
  credentials: value.credentials, cancelablePipelines: value.cancelablePipelines, permissions: value.permissions })
  && new Set(value.permissions.map(row => row.userId)).size === value.permissions.length
  && value.permissions.every(row => new Set(row.allowed).size === row.allowed.length));
export const GitLabFenceResponseSchema = z.strictObject({ before: GitLabNativeInstanceSchema, after: GitLabNativeInstanceSchema, receipt: GitLabFenceReceiptSchema });
export type GitLabFenceRequest = z.infer<typeof GitLabFenceRequestSchema>;
export type GitLabFenceReceipt = z.infer<typeof GitLabFenceReceiptSchema>;

/** Mutable state can change on replay; every original native identity must stay fixed. */
export function gitLabFenceOrigins(value: GitLabFenceRequest) {
  const order = <T>(rows: T[]) => [...rows].sort((a, b) => jsonHash(a).localeCompare(jsonHash(b)));
  return { project: value.project, tokens: order(value.credentials.tokens.map(({ revoked: _revoked, ...row }) => row)),
    users: order(value.credentials.users.map(({ state: _state, ...row }) => row)), memberships: order(value.credentials.memberships) };
}
