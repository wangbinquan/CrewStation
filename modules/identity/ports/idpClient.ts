import type { UserinfoRequestStyle } from '@crewstation/contracts';
import type { DiscoveryDocument, EffectiveEndpoints, EndpointConfig } from '../domain/endpointResolution';

export interface TokenResponse {
  readonly accessToken: string;
  /** 纯 OAuth 2.0 服务器不发 id_token；此时身份只能来自 userinfo。 */
  readonly idToken: string | null;
}

export interface ExchangeCodeInput {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

export interface FetchUserinfoInput {
  readonly userinfoEndpoint: string;
  readonly accessToken: string;
  readonly requestStyle: UserinfoRequestStyle;
  readonly clientId: string;
  readonly scopes: string;
}

export interface VerifyIdTokenInput {
  readonly idToken: string;
  readonly jwksUri: string;
  readonly issuer: string;
  readonly audience: string;
  readonly nonce: string;
}

/** 与企业 IdP 的全部出向交互；失败一律抛 domain 的 OidcLoginError，让用例直接映射成原因页。 */
export interface IdpClient {
  /** 取 discovery 文档；失败抛，由解析器回落手工端点。 */
  discover(issuerUrl: string): Promise<DiscoveryDocument>;
  exchangeCode(input: ExchangeCodeInput): Promise<TokenResponse>;
  fetchUserinfo(input: FetchUserinfoInput): Promise<unknown>;
  verifyIdToken(input: VerifyIdTokenInput): Promise<Record<string, unknown>>;
  /** 探针用：JWKS 是否真的给出一份 `{ keys: [...] }`。 */
  jwksReachable(jwksUri: string): Promise<boolean>;
}

/**
 * 端点解析：discovery 逐字段合并手工端点，并带正／负缓存。
 * 缓存是进程内的（多副本各自缓存不影响正确性），因此它是适配器而不是领域规则；
 * 用例只依赖这个端口，测试可以给一个不缓存的实现。
 */
export interface EndpointResolver {
  resolve(provider: EndpointConfig, options?: { readonly forceFresh?: boolean }): Promise<EffectiveEndpoints>;
}
