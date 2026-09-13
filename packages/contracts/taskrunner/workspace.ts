import { z } from 'zod';

/** Git 路径按 NUL 分隔解析；保留空格、中文、换行与重命名前的路径。 */
export const WorkspaceFileSchema = z.object({
  path: z.string(),
  status: z.string(),
  index: z.string(),
  worktree: z.string(),
  originalPath: z.string().optional(),
});
export const WorkspaceCommitSchema = z.object({ sha: z.string(), subject: z.string() });
export const GitUnavailableSchema = z.object({ status: z.literal('unavailable'), reason: z.string() });
export const WorkspaceUpstreamSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), name: z.string(), headSha: z.string(), ahead: z.number().int().min(0), behind: z.number().int().min(0) }),
  z.object({ status: z.literal('missing') }),
  GitUnavailableSchema,
]);
export const WorkspaceUnpushedSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), commits: z.array(WorkspaceCommitSchema), count: z.number().int().min(0), truncated: z.boolean() }),
  GitUnavailableSchema,
]);

export const WorkspaceReadySchema = z.object({
  status: z.literal('ready'),
  /** null 分别表示 detached HEAD 与尚无首次提交；不沿用开会话时的分支名。 */
  branch: z.string().nullable(),
  headSha: z.string().nullable(),
  shallow: z.boolean(),
  fingerprint: z.string(),
  uncommitted: z.array(WorkspaceFileSchema),
  uncommittedCount: z.number().int().min(0),
  uncommittedTruncated: z.boolean(),
  /** 所有本地分支及 HEAD 相对已知 remote refs 的未推送提交；不是生产差距。 */
  unpushed: WorkspaceUnpushedSchema,
  upstream: WorkspaceUpstreamSchema,
  checkedAt: z.iso.datetime(),
});
export const WorkspaceUnavailableSchema = GitUnavailableSchema.extend({ checkedAt: z.iso.datetime() });
export const RunnerWorkspaceStatusSchema = z.discriminatedUnion('status', [WorkspaceReadySchema, WorkspaceUnavailableSchema]);

export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;
export type WorkspaceCommit = z.infer<typeof WorkspaceCommitSchema>;
export type WorkspaceUpstream = z.infer<typeof WorkspaceUpstreamSchema>;
export type WorkspaceUnpushed = z.infer<typeof WorkspaceUnpushedSchema>;
export type WorkspaceReady = z.infer<typeof WorkspaceReadySchema>;
export type RunnerWorkspaceStatus = z.infer<typeof RunnerWorkspaceStatusSchema>;
