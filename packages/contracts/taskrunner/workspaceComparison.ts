import { z } from 'zod';
import { GitUnavailableSchema, RunnerWorkspaceStatusSchema, WorkspaceCommitSchema } from './workspace';

export const COMPARISON_PAGE_LIMIT = 100;
export const COMPARISON_PATCH_BYTES = 64 * 1024;
/** 仅用于目标版本仍有同名文件的 untracked 净差异；不影响普通 tracked diff。 */
export const COMPARISON_SCRATCH_BLOB_BYTES = 2 * 1024 * 1024;
export const COMPARISON_TTL_MS = 5 * 60 * 1000;
export const WORKSPACE_COMMAND_TIMEOUT_MS = 30_000;
export const COMPARISON_COMMAND_TIMEOUT_MS = 60_000;
export const COMPARISON_HISTORY_TIMEOUT_MS = 120_000;
export const GitObjectIdSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, '需要完整 Git 对象 SHA');
export const ComparisonTabSchema = z.enum(['ahead', 'behind', 'files', 'uncommitted']);
export const CommitComparisonSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['equal', 'ahead', 'behind', 'diverged']), ahead: z.number().int().min(0), behind: z.number().int().min(0) }),
  z.object({ status: z.literal('unrelated') }),
  z.object({ status: z.literal('undeployed') }),
  GitUnavailableSchema,
]);
export const ComparisonFileSchema = z.object({
  path: z.string(), originalPath: z.string().optional(), status: z.string(),
  additions: z.number().int().min(0).nullable(), deletions: z.number().int().min(0).nullable(), binary: z.boolean(),
  /** 当前 Git index 未跟踪这个路径；与目标版本可能仍有同名文件，净差异只计一次。 */
  untracked: z.boolean(),
});
export const ComparisonFileSummarySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), count: z.number().int().min(0), untrackedCount: z.number().int().min(0) }),
  GitUnavailableSchema,
]);
export const RunnerComparisonSchema = z.object({
  comparisonId: z.string().nullable(), targetSha: GitObjectIdSchema.optional(),
  workspace: RunnerWorkspaceStatusSchema, commits: CommitComparisonSchema, files: ComparisonFileSummarySchema,
  checkedAt: z.iso.datetime(), freshness: z.enum(['current', 'stale']),
});
export const ComparisonDetailQuerySchema = z.object({
  tab: ComparisonTabSchema, cursor: z.string().regex(/^\d+$/).max(9).optional(),
  limit: z.coerce.number().int().min(1).max(COMPARISON_PAGE_LIMIT).default(50),
  /** files／uncommitted 中选中的精确路径，用于取 patch。 */
  path: z.string().min(1).max(4096).optional(),
});
export const ComparisonDetailsSchema = z.object({
  comparisonId: z.string(), targetSha: GitObjectIdSchema.optional(), tab: ComparisonTabSchema,
  commits: z.array(WorkspaceCommitSchema), files: z.array(ComparisonFileSchema), nextCursor: z.string().optional(),
  truncated: z.boolean(),
  patch: z.object({ path: z.string(), text: z.string(), binary: z.boolean(), truncated: z.boolean() }).optional(),
  checkedAt: z.iso.datetime(),
});
export type CommitComparison = z.infer<typeof CommitComparisonSchema>;
export type ComparisonFile = z.infer<typeof ComparisonFileSchema>;
export type ComparisonFileSummary = z.infer<typeof ComparisonFileSummarySchema>;
export type RunnerComparison = z.infer<typeof RunnerComparisonSchema>;
export type ComparisonDetailQuery = z.infer<typeof ComparisonDetailQuerySchema>;
export type ComparisonDetails = z.infer<typeof ComparisonDetailsSchema>;
