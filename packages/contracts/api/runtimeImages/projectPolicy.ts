import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema } from '../../ids';

/** 与算力授权相同：继承平台范围，或只允许明确列出的镜像；空的受限集合禁止新采用。 */
export const ProjectRuntimeImagePolicySchema = z.object({
  mode: z.enum(['inherit', 'restricted']),
  allowedImageIds: z.array(ResourceIdSchema).max(512),
  additionalImageIds: z.array(ResourceIdSchema).max(512).optional(),
  excludedImageIds: z.array(ResourceIdSchema).max(512).optional(),
}).strict().refine((value) => new Set(value.allowedImageIds).size === value.allowedImageIds.length, '授权镜像重复')
  .refine((value) => value.mode !== 'inherit' || value.allowedImageIds.length === 0, '继承平台范围不能夹带指定镜像')
  .refine((value) => ['additionalImageIds', 'excludedImageIds'].every((key) => { const ids = value[key as 'additionalImageIds'] ?? []; return new Set(ids).size === ids.length; }), '镜像授权不能重复')
  .refine((value) => !value.additionalImageIds?.some((id) => value.excludedImageIds?.includes(id)), '明确授权和排除不能重叠');
export const ProjectRuntimeImagePolicyDtoSchema = z.object({
  projectId: ProjectIdSchema, revision: z.number().int().min(0), policy: ProjectRuntimeImagePolicySchema,
  updatedAt: z.iso.datetime().nullable(),
});
export const SaveProjectRuntimeImagePolicySchema = z.object({
  expectedRevision: z.number().int().min(0), policy: ProjectRuntimeImagePolicySchema,
}).strict();
export type ProjectRuntimeImagePolicy = z.infer<typeof ProjectRuntimeImagePolicySchema>;
export type ProjectRuntimeImagePolicyDto = z.infer<typeof ProjectRuntimeImagePolicyDtoSchema>;
export type SaveProjectRuntimeImagePolicy = z.infer<typeof SaveProjectRuntimeImagePolicySchema>;

/** 平台详情的授权解释：受限业务优先；其余业务继承默认范围及迁移保留授权。 */
export const RuntimeImageGrantsSchema = z.object({
  defaultVisible: z.boolean(),
  retainedProjectIds: z.array(ProjectIdSchema),
  overrides: z.array(z.object({ projectId: ProjectIdSchema, allowed: z.boolean() })),
});
export type RuntimeImageGrants = z.infer<typeof RuntimeImageGrantsSchema>;
