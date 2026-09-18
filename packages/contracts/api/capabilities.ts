import { z } from 'zod';
import { ApiOperationDtoSchema } from './apiCatalog';
import { DataResourceDtoSchema } from './data';
import { SubscriptionDtoSchema } from './events';
import { ComputeProfileSummaryDtoSchema } from './compute/computeProfile';
import { QuotaDtoSchema, ServicePlanDtoSchema } from './project';

/** 能力说明（R48）：一个服务当前可用的一切，工作台能力页与能力说明 MCP 同源。 */
export const CapabilityDescriptionDtoSchema = z.object({
  service: z.object({ identity: z.string(), slug: z.string(), namespace: z.string() }),
  hosts: z.object({ prod: z.string(), preview: z.string(), dev: z.string(), service: z.string(), platformApi: z.string() }),
  conventions: z.object({
    /** 头名约定表：名字本身的契约。用户身份头里哪些真的会到达本服务，看下面的 identityForwarding。 */
    identityHeaders: z.record(z.string(), z.string()),
    env: z.record(z.string(), z.string()),
    paths: z.record(z.string(), z.string()),
    eventHeaders: z.record(z.string(), z.string()),
  }),
  /**
   * 本项目实际生效的身份转发（RFC-005 §7.2）：平台按管理员配置裁剪外发字段，
   * 这里给出的是**当前真的会注入**的头与令牌声明，而不是静态常量表。
   */
  identityForwarding: z.object({
    source: z.enum(['global', 'project']),
    fields: z.array(z.string()),
    headers: z.array(z.string()),
    tokenClaims: z.array(z.string()),
  }),
  quota: QuotaDtoSchema.optional(),
  plan: ServicePlanDtoSchema.optional(),
  /** 本服务可用的算力档位（RFC-006）：只给名字、说明、是否仅终端、是否默认与可用性，业务据此在 Manifest 里写 compute 或 default。 */
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
