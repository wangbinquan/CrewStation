import { z } from 'zod';
import { ReleaseStatusSchema, SlotNameSchema } from '../events/topics';
import { ReleaseIdSchema, ServiceIdSchema, UserIdSchema } from '../ids';
import { ResourceReasonSchema } from './resources/resourceRecord';
import { FullCommitShaSchema } from './scm';

/** 待命槽下线的原因（RFC-021）：手动、切流后回退目标保留期满、待验证版本无人访问、集群管理删除。 */
export const OfflineReasonSchema = z.enum(['manual', 'rollback-expired', 'idle', 'cluster']);

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
  /** 可以从发布记录重新部署到待命槽：首次就绪过、有镜像与 Manifest、现在不在任何槽上（RFC-021 §4）。 */
  redeployable: z.boolean().optional(),
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

/** 待命槽的自动下线计时（RFC-021 §3）；deadline 由服务端按当前平台策略算好。 */
export const SlotRetentionDtoSchema = z.object({
  kind: z.enum(['rollback-target', 'pending']),
  since: z.iso.datetime(),
  deadline: z.iso.datetime(),
  /** 已为当前到期时间发过提醒。 */
  remindedAt: z.iso.datetime().optional(),
  /** 现在能不能推迟：为当前到期时间发过提醒之后才能推迟（2026-09-23 裁定）；界面据此显示「推迟」，服务端同一条规则拒绝。 */
  postponable: z.boolean(),
  postponements: z.number().int().min(0),
  /** 一个周期的小时数（回退保留期或无人访问期限）：推迟按它加，界面据此写「推迟 72 小时／14 天」。 */
  periodHours: z.number().int().positive(),
});

/** 待命槽已下线：下线的版本、时间、原因；平台自动下线时没有操作人。 */
export const SlotOfflineDtoSchema = z.object({
  releaseId: ReleaseIdSchema,
  tag: z.string().optional(),
  at: z.iso.datetime(),
  reason: OfflineReasonSchema,
  actorUserId: UserIdSchema.optional(),
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
  retention: SlotRetentionDtoSchema.optional(),
  offline: SlotOfflineDtoSchema.optional(),
});

/** 下线待验证版本：确认时看到的待命版本，已被替换时拒绝。 */
export const TakeOfflineRequestSchema = z.object({ expectedReleaseId: ReleaseIdSchema }).strict();
/** 推迟一个周期：确认时看到的到期时间，已变化（包括已被推迟过）时拒绝。 */
export const PostponeOfflineRequestSchema = z.object({ expectedDeadline: z.iso.datetime() }).strict();
/** 重新部署到待命槽：确认时待命槽上的版本，null 表示当时待命槽为空。 */
export const RedeployRequestSchema = z.object({ expectedStandbyReleaseId: ReleaseIdSchema.nullable() }).strict();
/** 重新部署的预检（RFC-025 设计 §5）：不通过时给标准原因（原因码、说明、出路）；确认时同样的原因以 412 返回。 */
export const RedeployPrecheckDtoSchema = z.object({ ok: z.boolean(), reason: ResourceReasonSchema.optional() }).strict();

export const SlotEventKindSchema = z.enum(['offline', 'redeploy', 'postpone', 'reminder']);
/** 待命槽的生命周期记录：下线、重新部署、推迟、提醒；进时间线。 */
export const SlotEventDtoSchema = z.object({
  id: z.string(),
  serviceId: ServiceIdSchema,
  kind: SlotEventKindSchema,
  releaseId: ReleaseIdSchema,
  tag: z.string(),
  reason: OfflineReasonSchema.optional(),
  actorUserId: UserIdSchema.optional(),
  /** 推迟后的新到期时间，或提醒所针对的到期时间。 */
  deadline: z.iso.datetime().optional(),
  at: z.iso.datetime(),
});

const autoOfflineFields = {
  rollbackRetentionHours: z.number().int().min(1).max(8760),
  idleOfflineDays: z.number().int().min(1).max(365),
  reminderLeadHours: z.number().int().min(1).max(720),
};
/** 平台统一的自动下线时长（RFC-021 M11、M12、M22）。 */
export const AutoOfflinePolicyDtoSchema = z.object({ ...autoOfflineFields, revision: z.number().int().min(0), updatedAt: z.iso.datetime().nullable(), updatedBy: UserIdSchema.optional() });
export const SetAutoOfflinePolicyRequestSchema = z.object({ ...autoOfflineFields, expectedRevision: z.number().int().min(0) }).strict().superRefine((value, context) => {
  if (value.reminderLeadHours >= value.rollbackRetentionHours) context.addIssue({ code: 'custom', path: ['reminderLeadHours'], message: '提前提醒的时间必须短于回退目标保留期' });
  if (value.reminderLeadHours >= value.idleOfflineDays * 24) context.addIssue({ code: 'custom', path: ['reminderLeadHours'], message: '提前提醒的时间必须短于无人访问期限' });
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
export type OfflineReason = z.infer<typeof OfflineReasonSchema>;
export type SlotRetentionDto = z.infer<typeof SlotRetentionDtoSchema>;
export type SlotOfflineDto = z.infer<typeof SlotOfflineDtoSchema>;
export type TakeOfflineRequest = z.infer<typeof TakeOfflineRequestSchema>;
export type PostponeOfflineRequest = z.infer<typeof PostponeOfflineRequestSchema>;
export type RedeployRequest = z.infer<typeof RedeployRequestSchema>;
export type RedeployPrecheckDto = z.infer<typeof RedeployPrecheckDtoSchema>;
export type SlotEventKind = z.infer<typeof SlotEventKindSchema>;
export type SlotEventDto = z.infer<typeof SlotEventDtoSchema>;
export type AutoOfflinePolicyDto = z.infer<typeof AutoOfflinePolicyDtoSchema>;
export type SetAutoOfflinePolicyRequest = z.infer<typeof SetAutoOfflinePolicyRequestSchema>;
