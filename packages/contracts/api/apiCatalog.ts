import { z } from 'zod';
import { ServiceIdSchema, SlugSchema, UserIdSchema } from '../ids';
import { HttpMethodSchema } from '../manifest/serviceSpec';

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
export type ApiRequestDto = z.infer<typeof ApiRequestDtoSchema>;
export type OpenPolicy = z.infer<typeof OpenPolicySchema>;
