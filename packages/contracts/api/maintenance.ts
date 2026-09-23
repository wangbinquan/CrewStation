import { z } from 'zod';
import { ProjectIdSchema, ServiceIdSchema, UserIdSchema } from '../ids';

/** 正式版本维护的三个开关（RFC-021 M7）：用户流量、服务域调用、事件推送，互相独立；true 表示拦住。 */
export const MaintenanceSwitchesSchema = z.object({ users: z.boolean(), services: z.boolean(), events: z.boolean() }).strict();

export const MAINTENANCE_LIMITS = { reason: 500, allowUsers: 100 } as const;

/** 维护期间临时放行的人（M4）；名字与邮箱供展示，查不到的用户不会出现在这里。 */
export const MaintenanceUserSchema = z.object({ userId: UserIdSchema, name: z.string(), email: z.string() });

export const MaintenanceDtoSchema = z.object({
  serviceId: ServiceIdSchema,
  projectId: ProjectIdSchema,
  switches: MaintenanceSwitchesSchema,
  allowUsers: z.array(MaintenanceUserSchema),
  /** 负责人进入维护时填写，维护页原样展示（M13）。 */
  reason: z.string(),
  expectedEndAt: z.iso.datetime().optional(),
  startedBy: UserIdSchema,
  startedAt: z.iso.datetime(),
  updatedBy: UserIdSchema,
  updatedAt: z.iso.datetime(),
  revision: z.number().int().min(1),
});

/** 进入或调整维护：`expectedRevision` 不在维护中时为 0；临时指定的人去重排序。 */
export const SetMaintenanceRequestSchema = z.object({
  switches: MaintenanceSwitchesSchema,
  allowUserIds: z.array(UserIdSchema).max(MAINTENANCE_LIMITS.allowUsers).transform((ids) => [...new Set(ids)].sort()),
  reason: z.string().trim().min(1, '请填写维护原因').max(MAINTENANCE_LIMITS.reason),
  expectedEndAt: z.iso.datetime().nullable().optional(),
  expectedRevision: z.number().int().min(0),
}).strict();

export const ExitMaintenanceRequestSchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

export const MaintenanceEventKindSchema = z.enum(['entered', 'updated', 'exited']);

/** 维护记录：每次进入、调整、退出一条，带当时的开关、原因与临时指定的人；进时间线。 */
export const MaintenanceEventDtoSchema = z.object({
  id: z.string(),
  serviceId: ServiceIdSchema,
  kind: MaintenanceEventKindSchema,
  actorUserId: UserIdSchema,
  at: z.iso.datetime(),
  switches: MaintenanceSwitchesSchema,
  reason: z.string(),
  expectedEndAt: z.iso.datetime().optional(),
  allowUserIds: z.array(UserIdSchema),
});

export const ServiceMaintenanceViewSchema = z.object({ current: MaintenanceDtoSchema.nullable(), history: z.array(MaintenanceEventDtoSchema) });

export type MaintenanceSwitches = z.infer<typeof MaintenanceSwitchesSchema>;
export type MaintenanceUser = z.infer<typeof MaintenanceUserSchema>;
export type MaintenanceDto = z.infer<typeof MaintenanceDtoSchema>;
export type SetMaintenanceRequest = z.infer<typeof SetMaintenanceRequestSchema>;
export type ExitMaintenanceRequest = z.infer<typeof ExitMaintenanceRequestSchema>;
export type MaintenanceEventKind = z.infer<typeof MaintenanceEventKindSchema>;
export type MaintenanceEventDto = z.infer<typeof MaintenanceEventDtoSchema>;
export type ServiceMaintenanceView = z.infer<typeof ServiceMaintenanceViewSchema>;
