import { z } from 'zod';
import { ProjectIdSchema, UserIdSchema } from '../../ids';
import { pageOf } from '../envelope';
import { PlatformRoleSchema } from '../identity';
import { ProjectStateSchema } from '../project';

export const AppVisibilityModeSchema = z.enum(['members', 'authenticated', 'selected']);
export const AppIconSchema = z.enum(['station', 'assistant', 'workflow', 'book', 'chart', 'spark']);
export const MemberCandidateDtoSchema = z.object({ userId: UserIdSchema, name: z.string(), email: z.string(), platformRole: PlatformRoleSchema.optional() });
export const MemberCandidatesQuerySchema = z.object({ identity: z.string().trim().min(1).max(254) });
export const SetAppVisibilityRequestSchema = z.object({
  mode: AppVisibilityModeSchema,
  userIds: z.array(UserIdSchema).max(200).transform((ids) => [...new Set(ids)].sort()),
  expectedRevision: z.number().int().min(0),
}).strict().superRefine((value, context) => {
  if (value.mode === 'selected' && value.userIds.length === 0) context.addIssue({ code: 'custom', path: ['userIds'], message: '请至少选择一位已注册用户' });
  if (value.mode !== 'selected' && value.userIds.length > 0) context.addIssue({ code: 'custom', path: ['userIds'], message: '仅指定用户范围接受用户清单' });
});
export const AppVisibilityDtoSchema = z.object({
  mode: AppVisibilityModeSchema, userIds: z.array(UserIdSchema), users: z.array(MemberCandidateDtoSchema),
  revision: z.number().int().min(0), updatedAt: z.iso.datetime().nullable(), canConfigure: z.boolean(),
});
export const AppVisibilityCheckDtoSchema = z.object({
  userId: UserIdSchema, visible: z.boolean(), revision: z.number().int().min(0), checkedAt: z.iso.datetime(),
  basis: z.enum(['admin', 'member', 'authenticated', 'selected', 'hidden']),
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
  production: z.discriminatedUnion('status', [
    z.object({ status: z.literal('deployed'), tag: z.string(), commitSha: z.string(), host: z.string(), state: z.enum(['deploying', 'ready', 'degraded', 'failed']), freshness: z.literal('current'), checkedAt: z.iso.datetime() }),
    z.object({ status: z.literal('not-deployed'), freshness: z.literal('current'), checkedAt: z.iso.datetime() }),
    z.object({ status: z.literal('unknown'), freshness: z.literal('unknown'), checkedAt: z.iso.datetime() }),
  ]),
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
export type AppVisibilityCheckDto = z.infer<typeof AppVisibilityCheckDtoSchema>;
export type SetAppPresentationRequest = z.infer<typeof SetAppPresentationRequestSchema>;
export type AppPresentationDto = z.infer<typeof AppPresentationDtoSchema>;
export type MarketAppsQuery = z.infer<typeof MarketAppsQuerySchema>;
export type MarketAppDto = z.infer<typeof MarketAppDtoSchema>;
export type MarketAppsPage = z.infer<typeof MarketAppsPageSchema>;
