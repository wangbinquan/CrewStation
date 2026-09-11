import { z } from 'zod';
import { ProjectIdSchema, UserIdSchema } from '../ids';

/** 出站白名单条目的域名模式：精确 FQDN 或 `*.` 通配一级及以上子域。 */
export const EgressFqdnPatternSchema = z.string().regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'FQDN 形如 api.example.com 或 *.example.com');
export const EgressScopeSchema = z.enum(['global', 'project']);
export const EgressRequestStateSchema = z.enum(['pending', 'approved', 'rejected']);
/** 被阻请求的来源：出站代理按发起容器归类。 */
export const EgressSourceSchema = z.enum(['dev-session', 'business-task', 'build', 'slot']);

/** 出站白名单（G23）：管理员维护全局清单，可按项目开放；项目可申请追加。 */
export const EgressEntryDtoSchema = z.object({
  id: z.string(),
  fqdn: EgressFqdnPatternSchema,
  scope: EgressScopeSchema,
  projectId: ProjectIdSchema.optional(),
  note: z.string().optional(),
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
});

export const AddEgressEntryRequestSchema = z.object({
  fqdn: EgressFqdnPatternSchema,
  scope: EgressScopeSchema,
  /** scope 为 project 时必填，为 global 时不得出现。 */
  projectId: ProjectIdSchema.optional(),
  note: z.string().max(200).optional(),
});

export const EgressRequestDtoSchema = z.object({
  id: z.string(),
  projectId: ProjectIdSchema,
  fqdn: z.string(),
  reason: z.string().optional(),
  state: EgressRequestStateSchema,
  requestedBy: UserIdSchema,
  decidedBy: UserIdSchema.optional(),
  decision: z.string().optional(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().optional(),
});

export const RequestEgressEntryRequestSchema = z.object({
  fqdn: EgressFqdnPatternSchema,
  reason: z.string().max(500).optional(),
});

export const DecideEgressRequestSchema = z.object({
  approve: z.boolean(),
  decision: z.string().max(500).optional(),
});

export const BlockedEgressDtoSchema = z.object({
  projectId: ProjectIdSchema,
  fqdn: z.string(),
  count: z.number().int().min(1),
  lastSeenAt: z.iso.datetime(),
  source: EgressSourceSchema.optional(),
});

/** 出站代理上报一次被阻请求（服务域内部接口）。 */
export const ReportBlockedEgressRequestSchema = z.object({
  projectId: ProjectIdSchema,
  fqdn: z.string().min(1).max(253),
  source: EgressSourceSchema.optional(),
});

/** 下发给出站代理的某项目有效放行清单：全局与项目级条目去重后的域名模式。 */
export const EgressPolicyDtoSchema = z.object({ allow: z.array(EgressFqdnPatternSchema) });

export type EgressScope = z.infer<typeof EgressScopeSchema>;
export type EgressRequestState = z.infer<typeof EgressRequestStateSchema>;
export type EgressSource = z.infer<typeof EgressSourceSchema>;
export type EgressEntryDto = z.infer<typeof EgressEntryDtoSchema>;
export type AddEgressEntryRequest = z.infer<typeof AddEgressEntryRequestSchema>;
export type EgressRequestDto = z.infer<typeof EgressRequestDtoSchema>;
export type RequestEgressEntryRequest = z.infer<typeof RequestEgressEntryRequestSchema>;
export type DecideEgressRequest = z.infer<typeof DecideEgressRequestSchema>;
export type BlockedEgressDto = z.infer<typeof BlockedEgressDtoSchema>;
export type ReportBlockedEgressRequest = z.infer<typeof ReportBlockedEgressRequestSchema>;
export type EgressPolicyDto = z.infer<typeof EgressPolicyDtoSchema>;
