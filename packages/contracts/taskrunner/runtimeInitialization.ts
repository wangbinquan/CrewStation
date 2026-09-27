import { z } from 'zod';
import { ResourceIdSchema } from '../ids';
import { RuntimeImageDigestSchema, RuntimeImageInitializerSchema, RuntimeImageToolCheckSchema } from '../api/runtimeImages/values';

/** 仅平台→Runner 的 Secret 通道；凭据明文不能进入任务 DTO、状态或日志。 */
export const RuntimeInitializationMaterialSchema = z.object({
  environmentId: ResourceIdSchema, startGeneration: z.number().int().positive(),
  versionId: ResourceIdSchema, initializerDigest: RuntimeImageDigestSchema,
  toolsPhase: z.enum(['startup', 'agent-before-start']).optional(),
  initializer: RuntimeImageInitializerSchema, tools: z.array(RuntimeImageToolCheckSchema).max(64),
  secrets: z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), z.string()).default({}),
}).strict().refine((m) => Object.keys(m.secrets).length === m.initializer.secrets.length && m.initializer.secrets.every((s) => m.secrets[s.id] !== undefined), '初始化 Secret 必须与显式声明一致');

export const RuntimeInitializationStatusSchema = z.object({
  enabled: z.boolean(), state: z.enum(['waiting', 'running', 'succeeded', 'failed', 'cancelled', 'unknown']),
  executionId: z.string().optional(), versionId: ResourceIdSchema.optional(), containerIdentity: z.string().optional(),
  steps: z.array(z.object({ id: z.string(), state: z.enum(['running', 'succeeded', 'failed', 'cancelled']), exitCode: z.number().int().nullable() })),
  checks: z.array(z.object({ key: z.string(), passed: z.boolean(), output: z.string().max(8192), exitCode: z.number().int().nullable() })),
  error: z.string().optional(),
}).strict();
export type RuntimeInitializationMaterial = z.infer<typeof RuntimeInitializationMaterialSchema>;
export type RuntimeInitializationStatus = z.infer<typeof RuntimeInitializationStatusSchema>;
