import { z } from 'zod';
import { ReleaseStatusSchema, SlotNameSchema } from '../events/topics';
import { ReleaseIdSchema, ServiceIdSchema, UserIdSchema } from '../ids';

export const ReleaseDtoSchema = z.object({
  id: ReleaseIdSchema,
  serviceId: ServiceIdSchema,
  tag: z.string(),
  commitSha: z.string(),
  branch: z.string(),
  image: z.string().optional(),
  status: ReleaseStatusSchema,
  slot: SlotNameSchema.optional(),
  configVersion: z.number().int().optional(),
  message: z.string().optional(),
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** 发布：平台检查未提交内容→代推→打标签→构建→兼容迁移→待命槽。 */
export const PublishRequestSchema = z.object({
  branch: z.string().min(1),
  /** 明确版本号或递增级别；缺省为 patch 递增。 */
  version: z.union([z.string().regex(/^v\d+\.\d+\.\d+$/), z.enum(['major', 'minor', 'patch'])]).default('patch'),
  message: z.string().max(500).optional(),
});

export const SlotDtoSchema = z.object({
  name: SlotNameSchema,
  active: z.boolean(),
  releaseId: ReleaseIdSchema.optional(),
  tag: z.string().optional(),
  commitSha: z.string().optional(),
  replicas: z.number().int().min(0),
  readyReplicas: z.number().int().min(0),
  state: z.enum(['empty', 'deploying', 'ready', 'degraded', 'failed']),
  host: z.string(),
});

export const TrafficSwitchRequestSchema = z.object({
  toSlot: SlotNameSchema,
  /** 与当前 active 槽的 Release 不一致时拒绝（迟到切流不覆盖）。 */
  expectedActiveRelease: ReleaseIdSchema.optional(),
  reason: z.string().max(500).optional(),
});

export const TrafficSwitchDtoSchema = z.object({
  id: z.string(),
  serviceId: ServiceIdSchema,
  fromSlot: SlotNameSchema,
  toSlot: SlotNameSchema,
  releaseId: ReleaseIdSchema,
  actorUserId: UserIdSchema,
  reason: z.string().optional(),
  createdAt: z.iso.datetime(),
});

export type ReleaseDto = z.infer<typeof ReleaseDtoSchema>;
export type PublishRequest = z.infer<typeof PublishRequestSchema>;
export type SlotDto = z.infer<typeof SlotDtoSchema>;
export type TrafficSwitchRequest = z.infer<typeof TrafficSwitchRequestSchema>;
export type TrafficSwitchDto = z.infer<typeof TrafficSwitchDtoSchema>;
