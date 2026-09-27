import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { ServiceProbesSchema } from '../../manifest/serviceProbes';

export const RuntimeImageArchitectureSchema = z.enum(['linux/amd64', 'linux/arm64']);
export const RuntimeImageUsageSchema = z.enum(['service', 'task', 'agent']);
export const RuntimeImageDigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const RuntimeImageRequestKeySchema = z.string().min(1).max(128).regex(/^[^\x00-\x1f\x7f]+$/);
export const RuntimeImageBuildStateSchema = z.enum(['queued', 'preparing', 'building', 'inspecting', 'succeeded', 'failed', 'cancelling', 'cancelled']);
export const RuntimeImageValidationStateSchema = z.enum(['queued', 'running', 'passed', 'failed', 'unknown', 'cancelling', 'cancelled']);
export const RuntimeImageArgvSchema = z.array(z.string().min(1).max(8192).refine((v) => !v.includes('\0'), '参数不能含 NUL')).min(1).max(128);

/** 镜像配置和初始化不能覆盖平台进程身份、模型／provider 或加载器设置。 */
export const RuntimeImageEnvNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/).refine((name) =>
  !/^(CS_|HOME$|PATH$|XDG_|LD_|NODE_OPTIONS$|BUN_OPTIONS$|PYTHONPATH$|ANTHROPIC_|OPENAI_|OPENCODE_|CLAUDE_)/.test(name), '平台保留变量不能覆盖');
export const RuntimeImageRelativePathSchema = z.string().min(1).max(512).refine((value) =>
  !value.startsWith('/') && !/[\\\x00-\x1f\x7f]/.test(value) && value.split('/').every((part) => part !== '..' && part !== ''), '路径必须位于构建上下文内');

export const RuntimeImageSecretRefSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  configDefinitionId: ResourceIdSchema,
  environment: z.enum(['development', 'production']).default('development'),
}).strict();

export const RuntimeImageSecretVersionSchema = z.object({
  environment: z.enum(['development', 'production']), definitionId: ResourceIdSchema, itemId: ResourceIdSchema, version: z.number().int().positive(),
}).strict();
export type RuntimeImageSecretVersion = z.infer<typeof RuntimeImageSecretVersionSchema>;

export const RuntimeImageInitializerSchema = z.object({
  steps: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), argv: RuntimeImageArgvSchema,
    cwd: z.string().startsWith('/').max(512).default('/work'),
    timeoutSeconds: z.number().int().min(1).max(3600).default(60),
  }).strict()).max(32).default([]),
  env: z.record(RuntimeImageEnvNameSchema, z.string().max(65536)).default({}),
  secrets: z.array(RuntimeImageSecretRefSchema).max(32).default([]),
}).strict().refine((value) => new Set(value.steps.map((s) => s.id)).size === value.steps.length, '初始化步骤 ID 重复')
  .refine((value) => new Set(value.secrets.map((s) => s.id)).size === value.secrets.length, '初始化 Secret ID 重复');

export const RuntimeImageToolCheckSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/),
  argv: RuntimeImageArgvSchema,
  cwd: z.string().startsWith('/').max(512).default('/work'),
  timeoutSeconds: z.number().int().min(1).max(300).default(30),
  expected: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), value: z.string().max(65536) }).strict(),
    z.object({ kind: z.literal('sha256'), value: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    z.object({ kind: z.literal('json'), value: z.record(z.string(), z.json()) }).strict(),
  ]),
}).strict();

/** 字段全部 optional，避免把旧 Manifest 缺省写法变成新的显式配置。 */
export const RuntimeImageSelectionSchema = z.object({
  runtimeImageVersionId: ResourceIdSchema.optional(),
  allowedRuntimeImageVersionIds: z.array(ResourceIdSchema).max(32).refine((ids) => new Set(ids).size === ids.length, '允许镜像版本重复').optional(),
}).strict();

export const RuntimeImageValidationTargetSchema = z.discriminatedUnion('usage', [
  z.object({ usage: z.literal('task') }).strict(),
  z.object({ usage: z.literal('agent'), profile: z.object({ profileId: ResourceIdSchema, revision: z.number().int().positive() }).strict() }).strict(),
  z.object({ usage: z.literal('service'), command: RuntimeImageArgvSchema, port: z.number().int().min(1).max(65535), healthPath: z.string().startsWith('/').max(512), probes: ServiceProbesSchema.optional() }).strict(),
]);

export type RuntimeImageArchitecture = z.infer<typeof RuntimeImageArchitectureSchema>;
export type RuntimeImageUsage = z.infer<typeof RuntimeImageUsageSchema>;
export type RuntimeImageBuildState = z.infer<typeof RuntimeImageBuildStateSchema>;
export type RuntimeImageValidationState = z.infer<typeof RuntimeImageValidationStateSchema>;
export type RuntimeImageInitializer = z.infer<typeof RuntimeImageInitializerSchema>;
export type RuntimeImageToolCheck = z.infer<typeof RuntimeImageToolCheckSchema>;
export type RuntimeImageSelection = z.infer<typeof RuntimeImageSelectionSchema>;
export type RuntimeImageValidationTarget = z.infer<typeof RuntimeImageValidationTargetSchema>;
export type RuntimeImageSecretRef = z.infer<typeof RuntimeImageSecretRefSchema>;
