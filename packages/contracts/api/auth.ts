import { z } from 'zod';

/** 演示身份适配器的登录请求；正式环境由 OIDC 适配器替代，工作台必须标注“演示身份”。 */
export const DemoLoginRequestSchema = z.object({
  username: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
  displayName: z.string().min(1).max(80).optional(),
  email: z.string().email().optional(),
  /** 登录后跳回的用户域地址；只允许平台用户域下的地址。 */
  returnTo: z.string().optional(),
});

export const IdentityProviderKindSchema = z.enum(['demo', 'oidc']);

export const AuthStatusDtoSchema = z.object({
  provider: IdentityProviderKindSchema,
  loginPath: z.string(),
  logoutPath: z.string(),
  jwksPath: z.string(),
});

export type DemoLoginRequest = z.infer<typeof DemoLoginRequestSchema>;
export type AuthStatusDto = z.infer<typeof AuthStatusDtoSchema>;
