import { z } from 'zod';
import { TOKEN_CLAIMS } from '../../convention';
import { WorkloadKindSchema } from '../../gateway/identity';
import { TraceIdSchema } from '../../ids';

/** 演示身份适配器的登录请求；正式环境由 OIDC 适配器替代，工作台必须标注“演示身份”。 */
export const DemoLoginRequestSchema = z.object({
  username: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
  displayName: z.string().min(1).max(80).optional(),
  email: z.string().email().optional(),
  /** 登录后跳回的用户域地址；只允许平台用户域下的地址。 */
  returnTo: z.string().optional(),
});

export const IdentityProviderKindSchema = z.enum(['demo', 'oidc']);

/** 一次会话是怎么建立的（RFC-005 §7.1）：本地用户名密码，或某个 OIDC Provider。 */
export const AuthMethodSchema = z.enum(['password', 'oidc']);

/** 常规登录（本地用户名＋密码）。 */
export const PasswordLoginRequestSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
  returnTo: z.string().optional(),
}).strict();

export const USERNAME_REGEX = /^[a-z][a-z0-9_-]{2,47}$/;
export const PASSWORD_MIN_LENGTH = 12;

/**
 * 引导：用安装期下发的引导令牌创建首位管理员（RFC-005 §5 ①→②）。
 * 角色固定管理员、状态固定可用，不提供普通用户或 OIDC 模式。
 */
export const BootstrapAdminRequestSchema = z.object({
  token: z.string().min(1).max(512),
  username: z.string().regex(USERNAME_REGEX),
  displayName: z.string().min(1).max(80),
  email: z.string().email().max(254),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(200),
  confirmPassword: z.string().min(PASSWORD_MIN_LENGTH).max(200),
}).strict().refine((v) => v.password === v.confirmPassword, { message: '两次输入的密码不一致', path: ['confirmPassword'] });

/** 登录方法发现：引导未完成时只有引导令牌一条路，与 agent-workflow 的 bootstrap／ready 判别式同形。 */
export const LoginDiscoveryDtoSchema = z.object({
  mode: z.enum(['bootstrap', 'ready']),
  passwordLoginEnabled: z.boolean(),
  bootstrapTokenEnabled: z.boolean(),
  providers: z.array(z.object({ slug: z.string(), displayName: z.string() }).strict()),
  loginPath: z.string(),
  logoutPath: z.string(),
  jwksPath: z.string(),
}).strict();

export const AuthStatusDtoSchema = z.object({
  provider: IdentityProviderKindSchema,
  loginPath: z.string(),
  logoutPath: z.string(),
  jwksPath: z.string(),
});

export type DemoLoginRequest = z.infer<typeof DemoLoginRequestSchema>;
export type IdentityProviderKind = z.infer<typeof IdentityProviderKindSchema>;
export type AuthStatusDto = z.infer<typeof AuthStatusDtoSchema>;
export type AuthMethod = z.infer<typeof AuthMethodSchema>;
export type PasswordLoginRequest = z.infer<typeof PasswordLoginRequestSchema>;
export type BootstrapAdminRequest = z.infer<typeof BootstrapAdminRequestSchema>;
export type LoginDiscoveryDto = z.infer<typeof LoginDiscoveryDtoSchema>;

/** `/.well-known/jwks.json` 的响应：在用签名钥与轮换重叠期内旧钥的公钥。 */
export const JwksDocumentSchema = z.object({ keys: z.array(z.record(z.string(), z.unknown())) });

/** 用户域主机对应的槽：prod、preview 两个部署槽加开发会话预览。 */
export const UserSlotSchema = z.enum(['prod', 'preview', 'dev']);

/**
 * 用户域身份令牌（`x-cs-identity-token`）的声明。aud 为 `service:<project>/<service>`（业务主机）或 `console`（工作台）；
 * 声明名与 TOKEN_CLAIMS 一致，业务按 CS_JWKS_URL 取公钥验签后读取。
 */
export const IdentityTokenClaimsSchema = z.object({
  iss: z.literal(TOKEN_CLAIMS.issuer),
  sub: z.string().startsWith(TOKEN_CLAIMS.subjectPrefixUser),
  aud: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
  cs_kind: z.literal('user'),
  name: z.string(),
  email: z.string(),
  cs_project: z.string().optional(),
  cs_slot: UserSlotSchema.optional(),
});

/** 服务域来源令牌（`x-cs-source-token`）的声明。aud 为 `service:<target>` 或 `platform-api`。 */
export const SourceTokenClaimsSchema = z.object({
  iss: z.literal(TOKEN_CLAIMS.issuer),
  sub: z.string().startsWith(TOKEN_CLAIMS.subjectPrefixService),
  aud: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
  cs_kind: WorkloadKindSchema,
  cs_project: z.string(),
  cs_slot: z.enum(['preview', 'prod']).optional(),
  cs_trace_id: TraceIdSchema.optional(),
});

export type JwksDocument = z.infer<typeof JwksDocumentSchema>;
export type UserSlot = z.infer<typeof UserSlotSchema>;
export type IdentityTokenClaims = z.infer<typeof IdentityTokenClaimsSchema>;
export type SourceTokenClaims = z.infer<typeof SourceTokenClaimsSchema>;
