import { z } from 'zod';
import { ProjectIdSchema, ServiceIdSchema, SlugSchema, UserIdSchema } from '../ids';
import { HttpMethodSchema, ManifestKindSchema } from '../manifest/serviceSpec';

export const OpenPolicySchema = z.enum(['default', 'targeted']);

export const ApiOperationDtoSchema = z.object({
  key: z.string(),
  proxy: SlugSchema,
  method: HttpMethodSchema,
  path: z.string(),
  summary: z.string().optional(),
  openPolicy: OpenPolicySchema,
  /** 目录中标注的资源语义，仅供业务与审批参考，平台不按它做资源级授权。 */
  resourceNote: z.string().optional(),
  /** 对当前服务而言是否已可调。 */
  granted: z.boolean().optional(),
});

export const ApiProxyStateSchema = z.enum(['active', 'removed']);

/** 目录中的一个代理：接入容器（APIProxy）或数字人以 `apis.exposes` 登记的自有 API（proxy 名即服务 slug）。 */
export const ApiProxyDtoSchema = z.object({
  proxy: SlugSchema,
  projectId: ProjectIdSchema,
  serviceId: ServiceIdSchema,
  kind: ManifestKindSchema,
  /** 只有接入容器有上游连接名；凭据由 cs-auth 按需下发，目录只记名字。 */
  upstreamConnection: SlugSchema.optional(),
  state: ApiProxyStateSchema,
  /** 当前活动操作数。 */
  operationCount: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
});

export const ApiRequestStateSchema = z.enum(['pending', 'approved', 'rejected']);

export const ApiRequestDtoSchema = z.object({
  id: z.string(),
  serviceId: ServiceIdSchema,
  operationKey: z.string(),
  state: ApiRequestStateSchema,
  reason: z.string().optional(),
  requestedBy: UserIdSchema,
  decidedBy: UserIdSchema.optional(),
  decision: z.string().optional(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().optional(),
});

export const CreateApiRequestSchema = z.object({ operationKey: z.string().min(1), reason: z.string().max(500).optional() });
export const DecideApiRequestSchema = z.object({ approve: z.boolean(), decision: z.string().max(500).optional() });
export const SetOpenPolicyRequestSchema = z.object({ openPolicy: OpenPolicySchema });

export type ApiOperationDto = z.infer<typeof ApiOperationDtoSchema>;
export type ApiProxyDto = z.infer<typeof ApiProxyDtoSchema>;
export type ApiProxyState = z.infer<typeof ApiProxyStateSchema>;
export type ApiRequestDto = z.infer<typeof ApiRequestDtoSchema>;
export type ApiRequestState = z.infer<typeof ApiRequestStateSchema>;
export type OpenPolicy = z.infer<typeof OpenPolicySchema>;
export type CreateApiRequest = z.infer<typeof CreateApiRequestSchema>;
export type DecideApiRequest = z.infer<typeof DecideApiRequestSchema>;
export type SetOpenPolicyRequest = z.infer<typeof SetOpenPolicyRequestSchema>;
