import type { IdentityProviderKind } from '@crewstation/contracts';

/** 登录适配器给出的用户；结构与 api/ExternalUser 相同。 */
export interface LoginPrincipal {
  /** 稳定外部标识：OIDC 的 sub，或 `demo:<username>`。 */
  externalId: string;
  name: string;
  email: string;
}

/** 演示适配器返回 HTML 表单；OIDC 适配器返回到企业 IdP 的跳转地址。 */
export type ProviderLoginPage = { kind: 'html'; html: string } | { kind: 'redirect'; location: string };

export interface ProviderLoginOutcome {
  principal: LoginPrincipal;
  /** 适配器从表单或 state 里带回的原始 returnTo；由用例层校验。 */
  returnTo?: string;
}

/** 企业登录适配（Design §3.2 IdentityProvider）：平台只认外部标识、姓名与邮箱。 */
export interface IdentityProvider {
  readonly kind: IdentityProviderKind;
  loginPage(context: { returnTo: string }): Promise<ProviderLoginPage>;
  /** 输入是登录提交的原始字段；参数不合法抛 validation。 */
  handleLogin(input: Record<string, unknown>): Promise<ProviderLoginOutcome>;
}
