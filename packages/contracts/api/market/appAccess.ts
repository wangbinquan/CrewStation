import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema, UserIdSchema } from '../../ids';
import { RequestProjectSchema } from '../requests/page';

/**
 * 应用使用申请（2026-09-24 裁定，RFC-003 §3 修订）：没有使用权的人从网关的「没有项目权限」页进工作台申请，
 * 负责人或管理员审批；批准即加为「用户」角色成员。一次裁决后不可更改，被拒后可以重新申请。
 */
export const AppAccessRequestStateSchema = z.enum(['pending', 'approved', 'rejected']);

export const AppAccessRequestDtoSchema = z.object({
  id: ResourceIdSchema,
  projectId: ProjectIdSchema,
  state: AppAccessRequestStateSchema,
  reason: z.string().optional(),
  requestedBy: UserIdSchema,
  /** 申请人的名字与邮箱；目录查不到时省略，界面回退到 ID。 */
  requestedByName: z.string().optional(),
  requestedByEmail: z.string().optional(),
  decidedBy: UserIdSchema.optional(),
  decidedByName: z.string().optional(),
  decision: z.string().optional(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().optional(),
  /** 管理空间的全局清单带上应用名；项目内清单省略。 */
  project: RequestProjectSchema.optional(),
});

export const CreateAppAccessRequestSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();
export const DecideAppAccessRequestSchema = z.object({ approve: z.boolean(), decision: z.string().trim().max(500).optional() }).strict();
export const AppAccessRequestPageSchema = z.object({ items: z.array(AppAccessRequestDtoSchema).max(50), nextCursor: z.string().min(1).max(2048).optional() });

/** 申请页读到的事实：只含使用应用需要的名字、负责人与本人的申请，不含项目内部数据。 */
export const AppAccessStatusDtoSchema = z.object({
  projectId: ProjectIdSchema,
  name: z.string(),
  owner: z.object({ name: z.string() }),
  /** 当前账号已能打开正式地址：管理员、任一成员角色，或范围是「全部登录用户」。 */
  granted: z.boolean(),
  /** 负责人允许申请；为 false 时页面只写「请联系项目负责人」。接入容器恒为 false。 */
  allowRequests: z.boolean(),
  /** 正式地址的主机名；工作台按自己的协议拼出「打开应用」的链接（与市场卡片同法）。 */
  appHost: z.string(),
  /** 本人最近的一条申请。 */
  latest: AppAccessRequestDtoSchema.optional(),
});

export type AppAccessRequestState = z.infer<typeof AppAccessRequestStateSchema>;
export type AppAccessRequestDto = z.infer<typeof AppAccessRequestDtoSchema>;
export type CreateAppAccessRequest = z.infer<typeof CreateAppAccessRequestSchema>;
export type DecideAppAccessRequest = z.infer<typeof DecideAppAccessRequestSchema>;
export type AppAccessRequestPage = z.infer<typeof AppAccessRequestPageSchema>;
export type AppAccessStatusDto = z.infer<typeof AppAccessStatusDtoSchema>;
