import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import {
  RuntimeImageArchitectureSchema, RuntimeImageInitializerSchema, RuntimeImageRelativePathSchema, RuntimeImageRequestKeySchema,
  RuntimeImageSecretRefSchema, RuntimeImageSelectionSchema, RuntimeImageToolCheckSchema, RuntimeImageUsageSchema, RuntimeImageValidationTargetSchema,
} from './values';

const BuildArgNameSchema = z.string().max(128).regex(/^[A-Za-z_][A-Za-z0-9_]*$/).refine((key) => !/^(CS_|BUILDKIT_|BUILDX_)/.test(key), '平台构建参数不能覆盖');
const BuildArgsSchema = z.record(BuildArgNameSchema, z.string().max(8192).refine((value) => !value.includes('\0'), '构建参数不能含 NUL'))
  .refine((args) => Object.keys(args).length <= 32, '最多 32 个构建参数')
  .refine((args) => new TextEncoder().encode(JSON.stringify(args)).length <= 8192, '构建参数总大小不能超过 8192 字节');
export const RuntimeImageSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('source'), repositoryBindingId: ResourceIdSchema, ref: z.string().min(1).max(256).regex(/^[^\x00-\x20\x7f]+$/),
    context: RuntimeImageRelativePathSchema.default('.'), dockerfile: RuntimeImageRelativePathSchema.refine((v) => v !== '.', '必须指定 Dockerfile 文件').default('Dockerfile'),
    target: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/).optional(),
    architecture: RuntimeImageArchitectureSchema, usage: RuntimeImageUsageSchema,
    baseProfile: z.object({ profileId: ResourceIdSchema, revision: z.number().int().positive() }).strict().optional(),
    buildArgs: BuildArgsSchema.default({}),
    secrets: z.array(RuntimeImageSecretRefSchema).max(32).default([]),
  }).strict().refine((v) => new Set(v.secrets.map((s) => s.id)).size === v.secrets.length, '构建 Secret ID 重复'),
  z.object({ kind: z.literal('existing'), reference: z.string().trim().min(1).max(512), architecture: RuntimeImageArchitectureSchema, usage: RuntimeImageUsageSchema }).strict(),
]);

export const CreateRuntimeImageRequestSchema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(1000).default('') }).strict();
export const UpdateRuntimeImageRequestSchema = z.object({
  expectedRevision: z.number().int().positive(), name: z.string().trim().min(1).max(80).optional(), description: z.string().max(1000).optional(), enabled: z.boolean().optional(),
}).strict();
export const CreateRuntimeImageRevisionSchema = z.object({
  source: RuntimeImageSourceSchema,
  initializer: RuntimeImageInitializerSchema.default({ steps: [], env: {}, secrets: [] }),
  tools: z.array(RuntimeImageToolCheckSchema).max(64).default([]),
}).strict().refine((v) => new Set(v.tools.map((t) => t.key)).size === v.tools.length, '工具检查 key 重复')
  .refine((v) => v.source.usage !== 'service' || (!v.initializer.steps.length && !Object.keys(v.initializer.env).length && !v.initializer.secrets.length && !v.tools.length), '服务镜像使用自己的启动命令和探针，不使用 Runner 初始化与工具清单');
export const StartRuntimeImageBuildSchema = z.object({ revisionId: ResourceIdSchema, requestKey: RuntimeImageRequestKeySchema }).strict();
export const CancelRuntimeImageOperationSchema = z.object({ requestKey: RuntimeImageRequestKeySchema }).strict();
export const StartImageValidationSchema = z.object({ requestKey: RuntimeImageRequestKeySchema, target: RuntimeImageValidationTargetSchema }).strict();
export const RuntimeImagePageQuerySchema = z.object({ before: ResourceIdSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).strict();
export const RuntimeImageLogQuerySchema = z.object({ after: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(100) }).strict();
export const SaveDevelopmentRuntimeImagesSchema = z.object({
  expectedRevision: z.number().int().min(0), developmentTask: RuntimeImageSelectionSchema,
  developmentAgents: z.array(z.object({ profileId: ResourceIdSchema, selection: RuntimeImageSelectionSchema }).strict()).max(128),
}).strict().refine((v) => new Set(v.developmentAgents.map((p) => p.profileId)).size === v.developmentAgents.length, '开发 Agent 档位重复');
export const ShareRuntimeImageSchema = z.object({ scope: z.enum(['project', 'shared']), expectedRevision: z.number().int().positive() }).strict();

export type RuntimeImageSource = z.infer<typeof RuntimeImageSourceSchema>;
export type CreateRuntimeImageRequest = z.infer<typeof CreateRuntimeImageRequestSchema>;
export type UpdateRuntimeImageRequest = z.infer<typeof UpdateRuntimeImageRequestSchema>;
export type CreateRuntimeImageRevision = z.infer<typeof CreateRuntimeImageRevisionSchema>;
export type StartRuntimeImageBuild = z.infer<typeof StartRuntimeImageBuildSchema>;
export type StartImageValidation = z.infer<typeof StartImageValidationSchema>;
export type RuntimeImagePageQuery = z.infer<typeof RuntimeImagePageQuerySchema>;
export type RuntimeImageLogQuery = z.infer<typeof RuntimeImageLogQuerySchema>;
export type SaveDevelopmentRuntimeImages = z.infer<typeof SaveDevelopmentRuntimeImagesSchema>;

/** Save the definition and its first prepared revision together; retries reuse the original result. */
export const CreateRuntimeImageSetupSchema = CreateRuntimeImageRequestSchema.extend({ requestKey: RuntimeImageRequestKeySchema, recipe: CreateRuntimeImageRevisionSchema });
export type CreateRuntimeImageSetup = z.infer<typeof CreateRuntimeImageSetupSchema>;
