import { z } from 'zod';
import { ProjectIdSchema, SlugSchema, TaskIdSchema } from '../ids';
import { TaskProfileDtoSchema } from './project';

/** 套餐资源快照只用于确认；执行时仍重新读取管理员当前定义并逐项匹配。 */
export const RebuildProfileSchema = TaskProfileDtoSchema.pick({ name: true, cpu: true, memory: true, storage: true }).strict();
export const RebuildDevSessionRequestSchema = z.object({
  requestId: z.uuid(),
  expectedTaskId: TaskIdSchema,
  expectedUpdatedAt: z.iso.datetime(),
  expectedVolumeUid: z.string().min(1).max(128),
  expectedPodUid: z.string().min(1).max(128).nullable(),
  /** 旧客户端省略时仍按失败环境恢复；升级运行中旧协议容器须显式确认。 */
  reason: z.enum(['failed', 'protocol_mismatch']).optional(),
  profile: RebuildProfileSchema,
}).strict();
export const DevSessionRebuildInspectionSchema = z.object({
  taskId: TaskIdSchema,
  projectId: ProjectIdSchema,
  updatedAt: z.iso.datetime(),
  podUid: z.string().min(1).nullable(),
  volume: z.object({ uid: z.string().min(1), capacity: z.string().min(1) }).strict(),
  currentProfile: SlugSchema,
  profiles: z.array(TaskProfileDtoSchema),
  checkedAt: z.iso.datetime(),
  reason: z.enum(['failed', 'protocol_mismatch']).optional(),
}).strict();
export const DevSessionRebuildStateSchema = z.enum(['queued', 'replacing', 'starting', 'ready', 'failed']);
export const DevSessionRebuildDtoSchema = z.object({
  requestId: z.uuid(), taskId: TaskIdSchema, state: DevSessionRebuildStateSchema,
  profile: RebuildProfileSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  message: z.string().optional(),
}).strict();
export type RebuildDevSessionRequest = z.infer<typeof RebuildDevSessionRequestSchema>;
export type DevSessionRebuildInspection = z.infer<typeof DevSessionRebuildInspectionSchema>;
export type DevSessionRebuildDto = z.infer<typeof DevSessionRebuildDtoSchema>;
export type RebuildProfile = z.infer<typeof RebuildProfileSchema>;
