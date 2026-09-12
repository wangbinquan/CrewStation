import { z } from 'zod';
import { SlugSchema } from '../ids';
import {
  DevelopmentSpecSchema, EnvEntrySchema, ExposedApiSchema, ManifestApiVersionSchema, ReleaseSpecSchema,
  RequestedApiSchema, ServiceSpecSchema, SubscriptionSchema,
} from './serviceSpec';
import { TasksSpecSchema } from './tasks';

const baseSpec = {
  service: ServiceSpecSchema,
  development: DevelopmentSpecSchema.optional(),
  env: z.array(EnvEntrySchema).default([]),
  release: ReleaseSpecSchema.default({ migration: { compatibility: 'none', destructive: false, rollback: 'switch-back' } }),
};

export const DigitalWorkerManifestSchema = z.object({
  apiVersion: ManifestApiVersionSchema,
  kind: z.literal('DigitalWorker'),
  spec: z.object({
    ...baseSpec,
    apis: z.object({
      requested: z.array(RequestedApiSchema).default([]),
      exposes: ExposedApiSchema.optional(),
    }).default({ requested: [] }),
    subscriptions: z.array(SubscriptionSchema).default([]),
    tasks: TasksSpecSchema.optional(),
  }),
});

export const ApiProxyManifestSchema = z.object({
  apiVersion: ManifestApiVersionSchema,
  kind: z.literal('APIProxy'),
  spec: z.object({
    ...baseSpec,
    /** 目录中的 proxy 名，也是 `/api/<proxy>/` 前缀。 */
    proxy: SlugSchema,
    upstream: z.object({
      /** 管理员登记的上游连接名，凭据由 cs-auth 按需下发。 */
      connection: SlugSchema,
    }),
    apis: z.object({ exposes: ExposedApiSchema }),
  }),
});

export const EventProducerManifestSchema = z.object({
  apiVersion: ManifestApiVersionSchema,
  kind: z.literal('EventProducer'),
  spec: z.object({
    ...baseSpec,
    producer: SlugSchema,
    ingress: z.object({
      path: z.string().startsWith('/'),
      verification: z.enum(['gitlab-token', 'hmac-sha256', 'none']).default('none'),
    }),
    produces: z.array(z.object({
      eventType: SubscriptionSchema.shape.eventType,
      schema: z.string().min(1).optional(),
    })).min(1),
  }),
});

export const ManifestSchema = z.discriminatedUnion('kind', [
  DigitalWorkerManifestSchema, ApiProxyManifestSchema, EventProducerManifestSchema,
]);

export type DigitalWorkerManifest = z.infer<typeof DigitalWorkerManifestSchema>;
export type ApiProxyManifest = z.infer<typeof ApiProxyManifestSchema>;
export type EventProducerManifest = z.infer<typeof EventProducerManifestSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

/** 目录操作键：`<proxy>:<METHOD>:<path>`，网关放行表与 Grant 都用它。 */
export function operationKey(proxy: string, method: string, path: string): string {
  return `${proxy}:${method.toUpperCase()}:${path}`;
}

/**
 * 把 Manifest 校验失败翻成一句能照着改的话。
 * 光有 zod 的原文不够用：`Unrecognized keys: "driver", "model"` 说清了哪里错，
 * 没说该改成什么，而这正是 RFC-001 之后每个老仓库都会撞上的一条。
 */
export function describeManifestFailure(error: z.ZodError): string {
  const issues = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const legacyCompute = error.issues.some((issue) => issue.path.includes('agentProfiles') && /driver|model|compute/.test(issue.message));
  const hint = legacyCompute
    ? '；算力已由平台统一提供（RFC-001）：把 agentProfiles 里的 driver 与 model 换成一行 `compute: <档位名>`，可用档位见工作台的平台管理 → 算力档位'
    : '';
  return `${issues.join('；')}${hint}`;
}
