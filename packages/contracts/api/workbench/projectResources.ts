import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema } from '../../ids';

export const ProjectServicePolicySchema = z.object({
  mode: z.enum(['inherit', 'restricted']),
  allowedPlanIds: z.array(ResourceIdSchema).max(200),
}).strict().superRefine((policy, ctx) => {
  if (new Set(policy.allowedPlanIds).size !== policy.allowedPlanIds.length) ctx.addIssue({ code: 'custom', path: ['allowedPlanIds'], message: '服务规格不能重复' });
  if (policy.mode === 'inherit' && policy.allowedPlanIds.length) ctx.addIssue({ code: 'custom', path: ['allowedPlanIds'], message: '继承模式不能指定服务规格清单' });
});
export const SaveProjectServicePolicySchema = z.object({ expectedRevision: z.number().int().min(0), policy: ProjectServicePolicySchema }).strict();
export const ProjectServicePolicyDtoSchema = z.object({
  projectId: ProjectIdSchema, revision: z.number().int().min(0), policy: ProjectServicePolicySchema, updatedAt: z.iso.datetime().nullable(),
});
export type ProjectServicePolicy = z.infer<typeof ProjectServicePolicySchema>;
export type SaveProjectServicePolicy = z.infer<typeof SaveProjectServicePolicySchema>;
export type ProjectServicePolicyDto = z.infer<typeof ProjectServicePolicyDtoSchema>;
