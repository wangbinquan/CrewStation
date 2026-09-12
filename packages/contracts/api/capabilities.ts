import { z } from 'zod';
import { ApiOperationDtoSchema } from './apiCatalog';
import { DataResourceDtoSchema } from './data';
import { SubscriptionDtoSchema } from './events';
import { ComputeProfileSummaryDtoSchema, QuotaDtoSchema, ServicePlanDtoSchema } from './project';

/** 能力说明（R48）：一个服务当前可用的一切，工作台能力页与能力说明 MCP 同源。 */
export const CapabilityDescriptionDtoSchema = z.object({
  service: z.object({ identity: z.string(), slug: z.string(), namespace: z.string() }),
  hosts: z.object({ prod: z.string(), preview: z.string(), dev: z.string(), service: z.string(), platformApi: z.string() }),
  conventions: z.object({
    identityHeaders: z.record(z.string(), z.string()),
    env: z.record(z.string(), z.string()),
    paths: z.record(z.string(), z.string()),
    eventHeaders: z.record(z.string(), z.string()),
  }),
  quota: QuotaDtoSchema.optional(),
  plan: ServicePlanDtoSchema.optional(),
  /** 本服务可用的算力档位（RFC-001）：只给名字与说明，业务据此在 Manifest 里写 compute。 */
  computeProfiles: z.array(ComputeProfileSummaryDtoSchema).default([]),
  config: z.object({ development: z.array(z.string()), production: z.array(z.string()) }),
  data: z.array(DataResourceDtoSchema),
  operations: z.array(ApiOperationDtoSchema),
  subscriptions: z.array(SubscriptionDtoSchema),
  mcp: z.array(z.object({ name: z.string(), url: z.string() })),
  businessTaskApi: z.array(z.object({ method: z.string(), path: z.string(), summary: z.string() })),
  generatedAt: z.iso.datetime(),
});

export type CapabilityDescriptionDto = z.infer<typeof CapabilityDescriptionDtoSchema>;
