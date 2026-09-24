import { z } from 'zod';
import { ProjectIdSchema, UserIdSchema } from '../../ids';
import { pageOf } from '../envelope';
import { PlatformRoleSchema } from '../identity';
import { ProjectStateSchema } from '../project';

/**
 * 应用可见范围（RFC-003 §3，2026-09-24 修订）：同时决定市场里谁看得到、网关放谁打开正式地址。
 * 「项目成员与指定用户」一档取消，原名单迁成「用户」角色成员（project/0012）。
 */
export const AppVisibilityModeSchema = z.enum(['members', 'authenticated']);
export const AppIconSchema = z.enum(['station', 'assistant', 'workflow', 'book', 'chart', 'spark']);
export const MemberCandidateDtoSchema = z.object({ userId: UserIdSchema, name: z.string(), email: z.string(), platformRole: PlatformRoleSchema.optional() });
export const MemberCandidatesQuerySchema = z.object({ identity: z.string().trim().min(1).max(254) });
/** `allowRequests`：没有使用权的人打开正式地址时，页面给「申请访问权限」（true）还是只写「请联系项目负责人」（false）。 */
export const SetAppVisibilityRequestSchema = z.object({
  mode: AppVisibilityModeSchema, allowRequests: z.boolean(), expectedRevision: z.number().int().min(0),
}).strict();
export const AppVisibilityDtoSchema = z.object({
  mode: AppVisibilityModeSchema, allowRequests: z.boolean(),
  revision: z.number().int().min(0), updatedAt: z.iso.datetime().nullable(), canConfigure: z.boolean(),
});
export const SetAppPresentationRequestSchema = z.object({
  description: z.string().trim().max(400), icon: AppIconSchema, expectedRevision: z.number().int().min(0),
}).strict();
export const AppPresentationDtoSchema = z.object({
  description: z.string(), icon: AppIconSchema, revision: z.number().int().min(0), updatedAt: z.iso.datetime().nullable(),
});
export const MarketAppsQuerySchema = z.object({
  q: z.string().trim().max(120).default(''), limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(1024).optional(),
});
export const MarketAppDtoSchema = z.object({
  projectId: ProjectIdSchema, name: z.string(), description: z.string(), icon: AppIconSchema,
  owner: z.object({ userId: UserIdSchema, name: z.string() }), projectState: ProjectStateSchema,
  canDevelop: z.boolean(), canConfigure: z.boolean(), canPreview: z.boolean(), visibilityRevision: z.number().int().min(0),
  entry: z.object({ kind: z.enum(['production', 'trial']), status: z.enum(['ready', 'unavailable', 'unknown']), host: z.string().optional() }),
  trial: z.object({ status: z.enum(['ready', 'unavailable', 'unknown']), host: z.string().optional() }).optional(),
  production: z.discriminatedUnion('status', [
    z.object({ status: z.literal('deployed'), tag: z.string(), commitSha: z.string(), host: z.string(), state: z.enum(['deploying', 'ready', 'degraded', 'failed']), freshness: z.literal('current'), checkedAt: z.iso.datetime() }),
    z.object({ status: z.literal('not-deployed'), freshness: z.literal('current'), checkedAt: z.iso.datetime() }),
    z.object({ status: z.literal('unknown'), freshness: z.literal('unknown'), checkedAt: z.iso.datetime() }),
  ]),
  /** 正式版本维护中（RFC-021）：原因、预计恢复时间，以及当前查看者是否被拦。 */
  maintenance: z.object({ reason: z.string(), expectedEndAt: z.iso.datetime().optional(), blocked: z.boolean() }).optional(),
  checkedAt: z.iso.datetime(),
});
export const MarketAppsPageSchema = pageOf(MarketAppDtoSchema);
export const MarketTrialDtoSchema = z.object({
  projectId: ProjectIdSchema, name: z.string(), status: z.enum(['ready', 'unavailable', 'unknown']),
  host: z.string().optional(), version: z.string().optional(), checkedAt: z.iso.datetime(), sharedData: z.literal(true),
});
export type MarketTrialDto = z.infer<typeof MarketTrialDtoSchema>;
export type AppVisibilityMode = z.infer<typeof AppVisibilityModeSchema>;
export type AppIcon = z.infer<typeof AppIconSchema>;
export type MemberCandidateDto = z.infer<typeof MemberCandidateDtoSchema>;
export type SetAppVisibilityRequest = z.infer<typeof SetAppVisibilityRequestSchema>;
export type AppVisibilityDto = z.infer<typeof AppVisibilityDtoSchema>;
export type SetAppPresentationRequest = z.infer<typeof SetAppPresentationRequestSchema>;
export type AppPresentationDto = z.infer<typeof AppPresentationDtoSchema>;
export type MarketAppsQuery = z.infer<typeof MarketAppsQuerySchema>;
export type MarketAppDto = z.infer<typeof MarketAppDtoSchema>;
export type MarketAppsPage = z.infer<typeof MarketAppsPageSchema>;
