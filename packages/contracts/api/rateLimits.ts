import { z } from 'zod';
import { ProjectIdSchema, UserIdSchema } from '../ids';

/**
 * 一只令牌桶（RFC-025 设计 §7.3，网关的 Traefik rateLimit）：平均每秒多少次、允许的突发。
 * 上下限只防手误（0 会让 Traefik 不限，太大等于没设），合理的取值由 T15 在本机校准。
 */
export const RateLimitBucketSchema = z.object({
  average: z.number().int().min(1).max(100_000),
  burst: z.number().int().min(1).max(200_000),
}).strict().refine((bucket) => bucket.burst >= bucket.average, { message: '突发不能小于平均', path: ['burst'] });

/** 平台接口（工作台与命令行的 `/v1`）：每个登录用户一只桶，另有每人同时在处理的请求数上限（推送流与终端连接不计）。 */
export const PlatformApiLimitsSchema = z.object({ perUser: RateLimitBucketSchema, inFlightPerUser: z.number().int().min(1).max(10_000) }).strict();
/** 用户域（数字人的正式与待验证主机）：每个用户在每个主机上一只桶，每个主机合计一只。 */
export const UserDomainLimitsSchema = z.object({ perUser: RateLimitBucketSchema, perHost: RateLimitBucketSchema }).strict();
/** 服务域（`/api/<proxy>`、数字人互调、事件推送）：每个来源服务对每个目标一只桶，每个目标合计一只。 */
export const ServiceDomainLimitsSchema = z.object({ perSource: RateLimitBucketSchema, perTarget: RateLimitBucketSchema }).strict();

export const RateLimitsSchema = z.object({ platformApi: PlatformApiLimitsSchema, userDomain: UserDomainLimitsSchema, serviceDomain: ServiceDomainLimitsSchema }).strict();
/** 项目覆盖：只覆盖这个项目的用户域与服务域，写了哪一项就整项照它，没写的照平台默认。 */
export const ProjectRateLimitOverrideSchema = z.object({ userDomain: UserDomainLimitsSchema.optional(), serviceDomain: ServiceDomainLimitsSchema.optional() }).strict();

/** 平台默认（管理空间「平台设置」）：没人改过时是内置默认，版本号 0。 */
export const RateLimitSettingsDtoSchema = RateLimitsSchema.extend({ revision: z.number().int().min(0), updatedAt: z.iso.datetime().nullable(), updatedBy: UserIdSchema.optional() });
/** 改平台默认：带开始修改时读到的版本号，别人先保存过时 409。 */
export const SetRateLimitSettingsRequestSchema = RateLimitsSchema.extend({ expectedRevision: z.number().int().min(0) }).strict();

/** 某个项目的限流：覆盖（没有为 null）与生效的用户域、服务域（覆盖＋平台默认）。 */
export const ProjectRateLimitsDtoSchema = z.object({
  projectId: ProjectIdSchema,
  override: ProjectRateLimitOverrideSchema.nullable(),
  effective: z.object({ userDomain: UserDomainLimitsSchema, serviceDomain: ServiceDomainLimitsSchema }).strict(),
  revision: z.number().int().min(0),
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: UserIdSchema.optional(),
});
/** 设或撤项目覆盖（null 是撤掉、回到平台默认）。 */
export const SetProjectRateLimitsRequestSchema = z.object({ override: ProjectRateLimitOverrideSchema.nullable(), expectedRevision: z.number().int().min(0) }).strict();

export type RateLimitBucket = z.infer<typeof RateLimitBucketSchema>;
export type RateLimits = z.infer<typeof RateLimitsSchema>;
export type ProjectRateLimitOverride = z.infer<typeof ProjectRateLimitOverrideSchema>;
export type RateLimitSettingsDto = z.infer<typeof RateLimitSettingsDtoSchema>;
export type SetRateLimitSettingsRequest = z.infer<typeof SetRateLimitSettingsRequestSchema>;
export type ProjectRateLimitsDto = z.infer<typeof ProjectRateLimitsDtoSchema>;
export type SetProjectRateLimitsRequest = z.infer<typeof SetProjectRateLimitsRequestSchema>;
