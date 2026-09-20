import { z } from 'zod';
import { ProjectIdSchema, SlugSchema } from '../../ids';
import { ComputeProfileNameSchema } from './computeProfile';

export const ProjectComputePolicySchema = z.object({
  mode: z.enum(['inherit', 'restricted']),
  allowedProfiles: z.array(ComputeProfileNameSchema).max(200),
  defaultProfile: ComputeProfileNameSchema.nullable(),
  devTaskProfile: SlugSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  const error = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (new Set(value.allowedProfiles).size !== value.allowedProfiles.length) error('allowedProfiles', '档位不能重复');
  if (value.mode === 'inherit' && value.allowedProfiles.length) error('allowedProfiles', '继承模式不能指定允许清单');
  if (value.mode === 'inherit' && value.defaultProfile) error('defaultProfile', '继承模式使用平台默认档位');
  if (value.mode === 'restricted' && value.defaultProfile && !value.allowedProfiles.includes(value.defaultProfile)) error('defaultProfile', '默认档位必须在允许清单内');
});
export const SaveProjectComputePolicySchema = z.object({ expectedRevision: z.number().int().min(0), policy: ProjectComputePolicySchema }).strict();
export const ProjectComputePolicyDtoSchema = z.object({
  projectId: ProjectIdSchema, revision: z.number().int().min(0), policy: ProjectComputePolicySchema,
  effectiveDefaultProfile: z.string().nullable(), effectiveDevTaskProfile: z.string(), updatedAt: z.iso.datetime().nullable(),
});
export type ProjectComputePolicy = z.infer<typeof ProjectComputePolicySchema>;
export type SaveProjectComputePolicy = z.infer<typeof SaveProjectComputePolicySchema>;
export type ProjectComputePolicyDto = z.infer<typeof ProjectComputePolicyDtoSchema>;
