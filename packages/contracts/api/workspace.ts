import { z } from 'zod';
import { TaskIdSchema } from '../ids';
import { WorkspaceReadySchema, WorkspaceUnavailableSchema } from '../taskrunner/workspace';
import { ReleaseIdSchema } from '../ids';
import { RunnerComparisonSchema } from '../taskrunner/workspaceComparison';

/** 只读预检；无会话为 404，断线／Git 失败必须保留 unavailable。 */
export const WorkspaceStatusDtoSchema = z.discriminatedUnion('status', [
  WorkspaceReadySchema.extend({ taskId: TaskIdSchema }),
  WorkspaceUnavailableSchema.extend({ taskId: TaskIdSchema }),
]);
export type WorkspaceStatusDto = z.infer<typeof WorkspaceStatusDtoSchema>;

export const ComparisonTargetSchema = z.enum(['prod', 'preview']);
export const ComparisonDeploymentSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), target: ComparisonTargetSchema, releaseId: ReleaseIdSchema, tag: z.string(), commitSha: z.string(), host: z.string(), state: z.string() }),
  z.object({ status: z.literal('undeployed'), target: ComparisonTargetSchema }),
  z.object({ status: z.literal('unavailable'), target: ComparisonTargetSchema, reason: z.string() }),
]);
export const VersionComparisonDtoSchema = RunnerComparisonSchema.extend({ taskId: TaskIdSchema, deployment: ComparisonDeploymentSchema, latestDeployment: ComparisonDeploymentSchema.optional() });
export type ComparisonTarget = z.infer<typeof ComparisonTargetSchema>;
export type ComparisonDeployment = z.infer<typeof ComparisonDeploymentSchema>;
export type VersionComparisonDto = z.infer<typeof VersionComparisonDtoSchema>;
