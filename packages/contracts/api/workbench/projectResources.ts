import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema } from '../../ids';

export const ProjectServicePolicySchema = z.object({
  mode: z.enum(['inherit', 'restricted']),
  allowedPlanIds: z.array(ResourceIdSchema).max(200),
  additionalPlanIds: z.array(ResourceIdSchema).max(200).optional(),
  excludedPlanIds: z.array(ResourceIdSchema).max(200).optional(),
}).strict().superRefine((policy, ctx) => {
  if (new Set(policy.allowedPlanIds).size !== policy.allowedPlanIds.length) ctx.addIssue({ code: 'custom', path: ['allowedPlanIds'], message: '服务规格不能重复' });
  if (policy.mode === 'inherit' && policy.allowedPlanIds.length) ctx.addIssue({ code: 'custom', path: ['allowedPlanIds'], message: '继承模式不能指定服务规格清单' });
  for (const key of ['additionalPlanIds', 'excludedPlanIds'] as const) if (new Set(policy[key] ?? []).size !== (policy[key] ?? []).length) ctx.addIssue({ code: 'custom', path: [key], message: '服务规格不能重复' });
  if (policy.additionalPlanIds?.some((id) => policy.excludedPlanIds?.includes(id))) ctx.addIssue({ code: 'custom', path: ['excludedPlanIds'], message: '明确授权和排除不能同时包含同一规格' });
});
export const SaveProjectServicePolicySchema = z.object({ expectedRevision: z.number().int().min(0), policy: ProjectServicePolicySchema }).strict();
export const ProjectServicePolicyDtoSchema = z.object({
  projectId: ProjectIdSchema, revision: z.number().int().min(0), policy: ProjectServicePolicySchema, updatedAt: z.iso.datetime().nullable(),
});
export type ProjectServicePolicy = z.infer<typeof ProjectServicePolicySchema>;
export type SaveProjectServicePolicy = z.infer<typeof SaveProjectServicePolicySchema>;
export type ProjectServicePolicyDto = z.infer<typeof ProjectServicePolicyDtoSchema>;
