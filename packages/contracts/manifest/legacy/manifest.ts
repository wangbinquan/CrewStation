import { z } from 'zod';
import { SlugSchema } from '../../ids';
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

export const LegacyManifestSchema = z.discriminatedUnion('kind', [
  DigitalWorkerManifestSchema, ApiProxyManifestSchema, EventProducerManifestSchema,
]);

export type DigitalWorkerManifest = z.infer<typeof DigitalWorkerManifestSchema>;
export type ApiProxyManifest = z.infer<typeof ApiProxyManifestSchema>;
export type EventProducerManifest = z.infer<typeof EventProducerManifestSchema>;
export type Manifest = z.infer<typeof LegacyManifestSchema>;
