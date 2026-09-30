import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema, SlugSchema, UserIdSchema } from '../../ids';
import { ProjectDeletionBlockerSchema, ProjectDeletionDigestSchema, ProjectDeletionInventorySchema, ProjectDeletionPhaseSchema, ProjectDeletionReceiptSchema, ProjectDeletionStateSchema, ProjectDeletionTargetSchema } from './values';

export const ProjectDeletionPlanSchema = z.object({
  id: ResourceIdSchema, target: ProjectDeletionTargetSchema, digest: ProjectDeletionDigestSchema, expiresAt: z.iso.datetime(),
  complete: z.boolean(), participants: z.array(ProjectDeletionInventorySchema), blockers: z.array(ProjectDeletionBlockerSchema),
  operationId: ResourceIdSchema.optional(), supersedes: ProjectDeletionDigestSchema.optional(),
}).strict().refine((plan) => Boolean(plan.operationId) === Boolean(plan.supersedes), '重新确认计划必须同时绑定原操作与前一摘要');
/** 完成后保留最小身份、确认摘要和回收证明；不保留资源原文、配置、代码或任务内容。 */
export const ProjectDeletionOperationSchema = z.object({
  id: ResourceIdSchema, project: z.object({ id: ProjectIdSchema, slug: SlugSchema, name: z.string().min(1).max(80) }).strict(),
  state: ProjectDeletionStateSchema, phase: ProjectDeletionPhaseSchema, confirmationDigest: ProjectDeletionDigestSchema,
  receipts: z.array(ProjectDeletionReceiptSchema), blockers: z.array(ProjectDeletionBlockerSchema),
  canRetry: z.boolean(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), completedAt: z.iso.datetime().optional(),
  confirmations: z.array(z.object({ planId: ResourceIdSchema, requestKey: ResourceIdSchema, digest: ProjectDeletionDigestSchema,
    confirmedBy: UserIdSchema, confirmedAt: z.iso.datetime() }).strict()).optional(),
}).strict().refine((operation) => !operation.confirmations || (operation.confirmations.length > 0 &&
  operation.confirmations.at(-1)!.digest === operation.confirmationDigest && new Set(operation.confirmations.map((c) => c.requestKey)).size === operation.confirmations.length), '确认历史须保持唯一请求键和当前摘要');
export type ProjectDeletionPlan = z.infer<typeof ProjectDeletionPlanSchema>;
export type ProjectDeletionOperation = z.infer<typeof ProjectDeletionOperationSchema>;
