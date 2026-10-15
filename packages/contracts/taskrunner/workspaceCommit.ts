import { z } from 'zod';
import { GitObjectIdSchema } from './workspaceComparison';
import { RunnerWorkspaceStatusSchema } from './workspace';

/** 同一次确认绑定 HEAD、分支与所有未提交文件的内容指纹；成功后旧请求不能再次提交。 */
export const CommitWorkspaceInputSchema = z.object({
  expectedHead: GitObjectIdSchema, expectedBranch: z.string().min(1).max(1024), expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  message: z.string().trim().min(1).max(500).refine(value => !value.includes('\0')),
}).strict();
export const CommitWorkspaceResultSchema = z.object({ commitSha: GitObjectIdSchema, branch: z.string(), workspace: RunnerWorkspaceStatusSchema }).strict();
export type CommitWorkspaceInput = z.infer<typeof CommitWorkspaceInputSchema>;
export type CommitWorkspaceResult = z.infer<typeof CommitWorkspaceResultSchema>;
