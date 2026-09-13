import { z } from 'zod';
import { ReleaseStatusSchema, SlotNameSchema } from '../events/topics';
import { ReleaseIdSchema, ServiceIdSchema, UserIdSchema } from '../ids';
import { FullCommitShaSchema } from './scm';

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
  /** 已向用户展示并确认的来源；远端分支变化需重新确认。 */
  expectedCommitSha: FullCommitShaSchema.optional(),
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
  /** null 明确表示确认时尚无正式版本；省略保留旧客户端语义。 */
  expectedActiveRelease: ReleaseIdSchema.nullable().optional(),
  /** 待命版本被后来发布替换时拒绝，不把旧确认应用到新目标。 */
  expectedTargetRelease: ReleaseIdSchema.optional(),
  reason: z.string().max(500).optional(),
});

export const TrafficSwitchDtoSchema = z.object({
  id: z.string(),
  serviceId: ServiceIdSchema,
  /** 迁走的角色（晋级与回退都是 preview→prod：待命槽接管生产流量）。 */
  fromSlot: SlotNameSchema,
  toSlot: SlotNameSchema,
  /** 切流后承接生产流量的发布。 */
  releaseId: ReleaseIdSchema,
  /** 切流前承接生产流量的发布；首次晋级时没有。回滚要知道从哪个版本切走的。 */
  previousReleaseId: ReleaseIdSchema.optional(),
  actorUserId: UserIdSchema,
  reason: z.string().optional(),
  createdAt: z.iso.datetime(),
});

export type ReleaseDto = z.infer<typeof ReleaseDtoSchema>;
export type PublishRequest = z.infer<typeof PublishRequestSchema>;
export type SlotDto = z.infer<typeof SlotDtoSchema>;
export type TrafficSwitchRequest = z.infer<typeof TrafficSwitchRequestSchema>;
export type TrafficSwitchDto = z.infer<typeof TrafficSwitchDtoSchema>;
