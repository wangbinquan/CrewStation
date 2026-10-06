/** Inventory-only frozen pre-RFC001 shape from fc833a01c4a6811e1bfaab0ae457ade21122fa67; never used by event replay or release execution. */
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
    }).strict().default({ requested: [] }),
    subscriptions: z.array(SubscriptionSchema).default([]),
    tasks: TasksSpecSchema.optional(),
  }).strict(),
}).strict();

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
    }).strict(),
    apis: z.object({ exposes: ExposedApiSchema }).strict(),
  }).strict(),
}).strict();

export const EventProducerManifestSchema = z.object({
  apiVersion: ManifestApiVersionSchema,
  kind: z.literal('EventProducer'),
  spec: z.object({
    ...baseSpec,
    producer: SlugSchema,
    ingress: z.object({
      path: z.string().startsWith('/'),
      verification: z.enum(['gitlab-token', 'hmac-sha256', 'none']).default('none'),
    }).strict(),
    produces: z.array(z.object({
      eventType: SubscriptionSchema.shape.eventType,
      schema: z.string().min(1).optional(),
    }).strict()).min(1),
  }).strict(),
}).strict();

export const ManifestSchema = z.discriminatedUnion('kind', [
  DigitalWorkerManifestSchema, ApiProxyManifestSchema, EventProducerManifestSchema,
]);
