import { z } from 'zod';
import { SlugSchema } from '../../ids';

export const ManifestApiVersionSchema = z.literal('crewstation/v1');
export const ManifestKindSchema = z.enum(['DigitalWorker', 'APIProxy', 'EventProducer']);
export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export const ServiceSpecSchema = z.object({
  command: z.array(z.string().min(1)).min(1),
  port: z.number().int().min(1).max(65535),
  healthPath: z.string().startsWith('/').default('/healthz'),
  /** 管理员定义的服务套餐名。 */
  plan: SlugSchema,
  replicas: z.number().int().min(1).max(20).default(1),
  releaseMode: z.enum(['rolling-compatible']).default('rolling-compatible'),
});

/** 开发会话内由 TaskRunner 自动启动的预览进程。 */
export const DevelopmentSpecSchema = z.object({
  command: z.array(z.string().min(1)).min(1),
  port: z.number().int().min(1).max(65535).optional(),
  /** 预览就绪判断路径，默认复用 service.healthPath。 */
  healthPath: z.string().startsWith('/').optional(),
});

export const EnvEntrySchema = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/, '环境变量名必须是大写蛇形'),
  from: z.enum(['config', 'secret']),
  /** 缺省时取 name 作为配置项键。 */
  key: z.string().min(1).optional(),
  /**
   * 生产组尚未维护该键时使用的兜底值：让模板仓库首个标签就能发布，负责人随后在工作台覆盖。
   * 密钥不允许带默认值——密钥必须由负责人显式提供。
   */
  default: z.string().optional(),
}).refine((e) => !(e.from === 'secret' && e.default !== undefined), { message: '密钥不能声明 default', path: ['default'] });

export const RequestedApiSchema = z.object({
  proxy: SlugSchema,
  method: HttpMethodSchema,
  path: z.string().startsWith('/'),
});

export const ExposedApiSchema = z.object({
  /** 相对仓库根的 OpenAPI 文件路径。 */
  openapi: z.string().min(1),
});

export const SubscriptionSchema = z.object({
  eventType: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, '事件类型形如 gitlab.pipeline.finished'),
  handlerPath: z.string().startsWith('/'),
});

export const MigrationSpecSchema = z.object({
  compatibility: z.enum(['none', 'expand-only', 'destructive']).default('none'),
  destructive: z.boolean().default(false),
  rollback: z.enum(['switch-back', 'blocked']).default('switch-back'),
});

export const ReleaseSpecSchema = z.object({
  migrationCommand: z.array(z.string().min(1)).min(1).optional(),
  migration: MigrationSpecSchema.default({ compatibility: 'none', destructive: false, rollback: 'switch-back' }),
});

export type ManifestKind = z.infer<typeof ManifestKindSchema>;
export type ServiceSpec = z.infer<typeof ServiceSpecSchema>;
export type EnvEntry = z.infer<typeof EnvEntrySchema>;
export type RequestedApi = z.infer<typeof RequestedApiSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type MigrationSpec = z.infer<typeof MigrationSpecSchema>;
export type HttpMethod = z.infer<typeof HttpMethodSchema>;
