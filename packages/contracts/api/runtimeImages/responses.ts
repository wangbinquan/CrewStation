import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { RuntimeImageSourceSchema } from './requests';
import {
  RuntimeImageArchitectureSchema, RuntimeImageBuildStateSchema, RuntimeImageDigestSchema, RuntimeImageInitializerSchema,
  RuntimeImageSecretVersionSchema, RuntimeImageToolCheckSchema, RuntimeImageValidationStateSchema, RuntimeImageValidationTargetSchema,
} from './values';

export const RuntimeImageDtoSchema = z.object({
  id: ResourceIdSchema, projectId: ResourceIdSchema, name: z.string(), description: z.string(), scope: z.enum(['project', 'shared']), enabled: z.boolean(),
  revision: z.number().int().positive(), createdBy: ResourceIdSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
export const RuntimeImageRevisionDtoSchema = z.object({
  id: ResourceIdSchema, imageId: ResourceIdSchema, revision: z.number().int().positive(), source: RuntimeImageSourceSchema,
  commitSha: z.string().regex(/^[0-9a-f]{40,64}$/).optional(), baseImage: z.string().optional(), recipeDigest: RuntimeImageDigestSchema,
  initializer: RuntimeImageInitializerSchema, tools: z.array(RuntimeImageToolCheckSchema), createdBy: ResourceIdSchema, createdAt: z.iso.datetime(),
});
export const RuntimeImageBuildDtoSchema = z.object({
  id: ResourceIdSchema, imageId: ResourceIdSchema, projectId: ResourceIdSchema, revisionId: ResourceIdSchema,
  state: RuntimeImageBuildStateSchema, stage: z.string(), createdBy: ResourceIdSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  deadline: z.iso.datetime(), attempt: z.number().int().positive(), versionId: ResourceIdSchema.optional(),
  resourceId: ResourceIdSchema.optional(), error: z.string().optional(), unknown: z.boolean().default(false),
});
export const RuntimeImageVersionDtoSchema = z.object({
  id: ResourceIdSchema, imageId: ResourceIdSchema, projectId: ResourceIdSchema, revisionId: ResourceIdSchema, buildId: ResourceIdSchema,
  repository: z.string(), digest: RuntimeImageDigestSchema, architecture: RuntimeImageArchitectureSchema,
  state: z.enum(['available', 'disabled', 'retiring', 'retired']), createdAt: z.iso.datetime(),
  initializerDigest: RuntimeImageDigestSchema, toolsDigest: RuntimeImageDigestSchema,
});
export const RuntimeImageOptionDtoSchema = RuntimeImageVersionDtoSchema.extend({ name: z.string() });
export type RuntimeImageOptionDto = z.infer<typeof RuntimeImageOptionDtoSchema>;
export const RuntimeImageValidationDtoSchema = z.object({
  id: ResourceIdSchema, versionId: ResourceIdSchema, projectId: ResourceIdSchema, target: RuntimeImageValidationTargetSchema,
  state: RuntimeImageValidationStateSchema, contractDigest: RuntimeImageDigestSchema,
  createdBy: ResourceIdSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  verification: z.enum(['runtime', 'service-contract']).optional(),
  observedImageId: z.string().optional(), error: z.string().optional(),
  checks: z.array(z.object({ key: z.string(), passed: z.boolean(), output: z.string(), exitCode: z.number().int().nullable() })),
});
export const RuntimeImageExecutionSnapshotSchema = z.object({
  versionId: ResourceIdSchema, image: z.string().min(1), digest: RuntimeImageDigestSchema, architecture: RuntimeImageArchitectureSchema,
  initializerSecretVersions: z.array(RuntimeImageSecretVersionSchema).max(32).optional(),
  validationId: ResourceIdSchema, initializerDigest: RuntimeImageDigestSchema, initializer: RuntimeImageInitializerSchema,
  tools: z.array(RuntimeImageToolCheckSchema), selectionSource: z.enum(['request', 'configuration']),
}).strict().refine((snapshot) => /^[^\s@]+@sha256:[0-9a-f]{64}$/.test(snapshot.image) && snapshot.image.endsWith(`@${snapshot.digest}`), '运行镜像地址必须固定到快照中的摘要');
export const RuntimeImageLogPageSchema = z.object({
  items: z.array(z.object({ sequence: z.number().int().positive(), stage: z.string(), text: z.string(), createdAt: z.iso.datetime() })),
  next: z.number().int().min(0), truncated: z.boolean(), expiresAt: z.iso.datetime(),
});
export const RuntimeImageReferenceDtoSchema = z.object({
  id: ResourceIdSchema, versionId: ResourceIdSchema, projectId: ResourceIdSchema,
  ownerType: z.enum(['release', 'task', 'agent', 'session', 'development-config', 'validation']), ownerId: z.string(),
  state: z.enum(['reserved', 'confirmed']), expiresAt: z.iso.datetime().nullable(), createdAt: z.iso.datetime(),
});
export type RuntimeImageReferenceDto = z.infer<typeof RuntimeImageReferenceDtoSchema>;

export type RuntimeImageDto = z.infer<typeof RuntimeImageDtoSchema>;
export type RuntimeImageRevisionDto = z.infer<typeof RuntimeImageRevisionDtoSchema>;
export type RuntimeImageBuildDto = z.infer<typeof RuntimeImageBuildDtoSchema>;
export type RuntimeImageVersionDto = z.infer<typeof RuntimeImageVersionDtoSchema>;
export type RuntimeImageValidationDto = z.infer<typeof RuntimeImageValidationDtoSchema>;
export type RuntimeImageExecutionSnapshot = z.infer<typeof RuntimeImageExecutionSnapshotSchema>;
export type RuntimeImageLogPage = z.infer<typeof RuntimeImageLogPageSchema>;
