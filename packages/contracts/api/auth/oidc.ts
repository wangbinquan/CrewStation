import { z } from 'zod';
import { OidcProviderIdSchema, ProjectIdSchema, UserIdSchema } from '../../ids';

/** 开通策略（RFC-005 A3）：auto＝任何成功登录即建档；allowlist＝邮箱已验证且域名命中才建档。 */
export const ProvisioningPolicySchema = z.enum(['auto', 'allowlist']);

/**
 * userinfo 的调用方式。get_bearer 是标准 OIDC：GET＋`Authorization: Bearer`。
 * post_json 是部分公司平台的非标形态：POST，体固定为 `{ client_id, access_token, scope }`，且不带鉴权头。
 */
export const UserinfoRequestStyleSchema = z.enum(['get_bearer', 'post_json']);

export const PROVIDER_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const EMAIL_DOMAIN_REGEX = /^@[a-z0-9.-]+$/i;
/** 单个字段名选择器：只允许朴素键名，挡住路径表达式。 */
export const CLAIM_NAME_REGEX = /^[A-Za-z0-9_.-]{1,64}$/;
/** 转发字段名同时是 HTTP 头名的一段，因此比字段选择器更严。 */
export const FORWARDING_FIELD_KEY_REGEX = /^[a-z][a-z0-9-]{0,30}$/;
/** 固定可转发字段；`user-id` 恒定转发，不出现在集合里。 */
export const FIXED_FORWARDING_FIELDS = ['name', 'email', 'git-name'] as const;

const BANNED_CLAIM_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const ClaimNameSchema = z.string().regex(CLAIM_NAME_REGEX).refine((v) => !BANNED_CLAIM_KEYS.has(v), { message: '保留的对象键名不能作为字段名' });

/** 显示名与 Git 名是 1–8 个字段名的空格列表，取值时按序拼接。519 ＝ 8×64＋7 个分隔空格。 */
const ClaimNameListSchema = z
  .string()
  .max(519)
  .regex(/^[A-Za-z0-9_.-]{1,64}( [A-Za-z0-9_.-]{1,64}){0,7}$/)
  .refine((v) => v.split(' ').every((t) => !BANNED_CLAIM_KEYS.has(t)), { message: '保留的对象键名不能作为字段名' });

/** 手工端点必须是 http(s)：授权地址会被浏览器直接跳转，javascript: 之类会在登录页上执行。 */
const HttpUrlSchema = z.string().max(2048).regex(/^https?:\/\//i).refine((v) => URL.canParse(v), { message: '必须是可解析的 http(s) 地址' });

/** 自定义字段映射（RFC-005 A10）：把 userinfo 的任意字段记成平台字段名，key 同时决定转发时的头名。 */
export const ClaimMappingSchema = z.object({
  key: z.string().regex(FORWARDING_FIELD_KEY_REGEX),
  claim: ClaimNameSchema,
}).strict();

export const OidcProviderDtoSchema = z.object({
  id: OidcProviderIdSchema,
  slug: z.string().min(1).max(64).regex(PROVIDER_SLUG_REGEX),
  displayName: z.string().min(1).max(128),
  issuerUrl: HttpUrlSchema,
  clientId: z.string().min(1).max(256),
  /** 密文只进不出：接口只回「是否已设置」。 */
  clientSecretSet: z.boolean(),
  scopes: z.string().min(1).max(512),
  provisioning: ProvisioningPolicySchema,
  allowedEmailDomains: z.array(z.string().regex(EMAIL_DOMAIN_REGEX)).max(50),
  iconUrl: z.string().max(2048).nullable(),
  enabled: z.boolean(),
  authorizationEndpoint: HttpUrlSchema.nullable(),
  tokenEndpoint: HttpUrlSchema.nullable(),
  userinfoEndpoint: HttpUrlSchema.nullable(),
  userinfoRequestStyle: UserinfoRequestStyleSchema,
  jwksUri: HttpUrlSchema.nullable(),
  trustEmailVerified: z.boolean(),
  usernameClaim: ClaimNameListSchema.nullable(),
  gitNameClaim: ClaimNameListSchema.nullable(),
  emailClaim: ClaimNameSchema.nullable(),
  subjectClaim: ClaimNameSchema.nullable(),
  claimMappings: z.array(ClaimMappingSchema).max(20),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();

export const CreateOidcProviderRequestSchema = OidcProviderDtoSchema.omit({ id: true, clientSecretSet: true, createdAt: true, updatedAt: true })
  .extend({ clientSecret: z.string().min(1).max(1024) })
  .partial({
    allowedEmailDomains: true, iconUrl: true, enabled: true, authorizationEndpoint: true, tokenEndpoint: true, userinfoEndpoint: true,
    userinfoRequestStyle: true, jwksUri: true, trustEmailVerified: true, usernameClaim: true, gitNameClaim: true, emailClaim: true,
    subjectClaim: true, claimMappings: true,
  })
  .strict();

/** 改：留空的 clientSecret 表示保持原值，因此它可缺省而不是可为空。 */
export const PatchOidcProviderRequestSchema = CreateOidcProviderRequestSchema.partial().strict();

export const OidcEndpointSourceSchema = z.enum(['discovery', 'manual']);

/** 探针（测试连接）结果：始终随 200 返回，配置坏掉时逐项诊断最有价值。 */
export const OidcProbeResultSchema = z.object({
  ok: z.boolean(),
  discovery: z.object({ ok: z.boolean(), error: z.string().optional() }).strict(),
  issuer: z.string(),
  endpoints: z.object({
    authorizationEndpoint: z.object({ url: z.string(), source: OidcEndpointSourceSchema }).strict().nullable(),
    tokenEndpoint: z.object({ url: z.string(), source: OidcEndpointSourceSchema }).strict().nullable(),
    userinfoEndpoint: z.object({ url: z.string(), source: OidcEndpointSourceSchema }).strict().nullable(),
    jwksUri: z.object({ url: z.string(), source: OidcEndpointSourceSchema }).strict().nullable(),
  }).strict(),
  jwksReachable: z.boolean().optional(),
  scopesSupported: z.array(z.string()),
}).strict();

/** 登录策略（RFC-005 §6.1）。bootstrapCompletedAt 为空表示引导令牌仍是唯一入口。 */
export const LoginPolicyDtoSchema = z.object({
  passwordLoginEnabled: z.boolean(),
  bootstrapCompletedAt: z.iso.datetime().nullable(),
  /** 安装配置 `CS_PASSWORD_LOGIN=force-on` 时为真：库内策略暂不生效，界面禁改。 */
  forcedOn: z.boolean(),
  enabledProviderCount: z.number().int().min(0),
  /** 调用者当前会话的认证方式；关闭常规登录要求它是 oidc。 */
  callerAuthMethod: z.enum(['password', 'oidc']),
}).strict();

export const UpdateLoginPolicyRequestSchema = z.object({ passwordLoginEnabled: z.boolean() }).strict();

/** 一个可转发字段的来源：固定字段，或某 Provider 的自定义映射。 */
export const ForwardingCandidateSchema = z.object({
  key: z.string().regex(FORWARDING_FIELD_KEY_REGEX),
  kind: z.enum(['fixed', 'mapped']),
  /** mapped 时给出声明它的 Provider slug 列表，便于管理员判断影响面。 */
  providers: z.array(z.string()).default([]),
}).strict();

export const ProjectForwardingOverrideSchema = z.object({
  projectId: ProjectIdSchema,
  fields: z.array(z.string().regex(FORWARDING_FIELD_KEY_REGEX)).max(40),
  updatedBy: UserIdSchema,
  updatedAt: z.iso.datetime(),
}).strict();

export const IdentityForwardingDtoSchema = z.object({
  global: z.object({
    fields: z.array(z.string().regex(FORWARDING_FIELD_KEY_REGEX)).max(40),
    updatedBy: UserIdSchema.nullable(),
    updatedAt: z.iso.datetime().nullable(),
  }).strict(),
  projects: z.array(ProjectForwardingOverrideSchema),
  candidates: z.array(ForwardingCandidateSchema),
}).strict();

export const UpdateIdentityForwardingRequestSchema = z.object({
  fields: z.array(z.string().regex(FORWARDING_FIELD_KEY_REGEX)).max(40),
}).strict();

/** 生效预览：某项目的业务实际会收到的头与令牌声明；能力说明页读同一份。 */
export const EffectiveForwardingDtoSchema = z.object({
  projectId: ProjectIdSchema,
  source: z.enum(['global', 'project']),
  fields: z.array(z.string()),
  headers: z.array(z.string()),
  tokenClaims: z.array(z.string()),
}).strict();

export type ProvisioningPolicy = z.infer<typeof ProvisioningPolicySchema>;
export type UserinfoRequestStyle = z.infer<typeof UserinfoRequestStyleSchema>;
export type ClaimMapping = z.infer<typeof ClaimMappingSchema>;
export type OidcProviderDto = z.infer<typeof OidcProviderDtoSchema>;
export type CreateOidcProviderRequest = z.infer<typeof CreateOidcProviderRequestSchema>;
export type PatchOidcProviderRequest = z.infer<typeof PatchOidcProviderRequestSchema>;
export type OidcEndpointSource = z.infer<typeof OidcEndpointSourceSchema>;
export type OidcProbeResult = z.infer<typeof OidcProbeResultSchema>;
export type LoginPolicyDto = z.infer<typeof LoginPolicyDtoSchema>;
export type UpdateLoginPolicyRequest = z.infer<typeof UpdateLoginPolicyRequestSchema>;
export type ForwardingCandidate = z.infer<typeof ForwardingCandidateSchema>;
export type ProjectForwardingOverride = z.infer<typeof ProjectForwardingOverrideSchema>;
export type IdentityForwardingDto = z.infer<typeof IdentityForwardingDtoSchema>;
export type UpdateIdentityForwardingRequest = z.infer<typeof UpdateIdentityForwardingRequestSchema>;
export type EffectiveForwardingDto = z.infer<typeof EffectiveForwardingDtoSchema>;
