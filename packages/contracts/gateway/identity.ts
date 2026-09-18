import { z } from 'zod';
import { TaskIdSchema } from '../ids';

/** 服务身份的字符串形式：`<project>/<service>`。 */
export const ServiceIdentitySchema = z.string().regex(/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/, '服务身份形如 project/service');

export const WorkloadKindSchema = z.enum(['service', 'dev-session', 'business-task', 'platform']);

/**
 * 平台内部头：**不属于**业务接入约定表 `IDENTITY_HEADERS`，业务服务永远收不到。
 * 用户域 ForwardAuth 只在目标是工作台时注入，让 cs-api 知道当前会话是怎么建立的（RFC-005 §7.1）。
 */
export const PLATFORM_INTERNAL_HEADERS = { authMethod: 'x-cs-auth-method' } as const;

export const WorkloadIdentitySchema = z.object({
  identity: ServiceIdentitySchema,
  project: z.string().min(1),
  service: z.string().min(1),
  kind: WorkloadKindSchema,
  /** 两槽之一；开发会话与业务任务无槽。 */
  slot: z.enum(['preview', 'prod']).optional(),
  taskId: TaskIdSchema.optional(),
});

/** Pod 身份索引：cs-controller 按 Pod 创建与删除增量维护，cs-auth 按源 Pod IP 反查。 */
export const PodIdentityEntrySchema = z.object({
  ip: z.union([z.ipv4(), z.ipv6()]),
  podName: z.string().min(1),
  namespace: z.string().min(1),
  workload: WorkloadIdentitySchema,
  /** 索引条目版本；同一 IP 复用时以更大的版本为准。 */
  version: z.number().int().min(1),
});

export const PodIdentityIndexSchema = z.object({
  version: z.number().int().min(0),
  generatedAt: z.iso.datetime(),
  entries: z.array(PodIdentityEntrySchema),
});

export type ServiceIdentity = z.infer<typeof ServiceIdentitySchema>;
export type WorkloadIdentity = z.infer<typeof WorkloadIdentitySchema>;
export type WorkloadKind = z.infer<typeof WorkloadKindSchema>;
export type PodIdentityEntry = z.infer<typeof PodIdentityEntrySchema>;
export type PodIdentityIndex = z.infer<typeof PodIdentityIndexSchema>;
