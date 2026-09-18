import type { DiscoveryDocument } from '../domain/endpointResolution';
import { OidcLoginError } from '../domain/idpClaims';
import { codeChallengeOf } from '../domain/oidcFlow';
import type { EndpointResolver, IdpClient } from '../ports/idpClient';

export interface FakeIdpState {
  /** discovery 文档；null 表示自动发现失败（纯 OAuth 2.0 或网络不通）。 */
  discovery: DiscoveryDocument | null;
  /** 换码返回的 id_token（null＝纯 OAuth 2.0 服务器）。 */
  idToken: string | null;
  userinfo: unknown;
  /** 记录最后一次 userinfo 调用，用来断言 post_json 风格与 scope 原样传递。 */
  lastUserinfo?: { endpoint: string; style: string; clientId: string; scopes: string; accessToken: string };
  /** 已验证 id_token 的载荷；抛错则模拟验签失败。 */
  verified: Record<string, unknown> | 'fail';
  jwksReachable: boolean;
  /** 记录换码入参：PKCE 与 redirect_uri 必须与发起时一致。 */
  lastExchange?: { code: string; codeVerifier: string; redirectUri: string; clientSecret: string };
  tokenEndpointFails?: boolean;
  userinfoFails?: boolean;
}

export function fakeIdp(state: FakeIdpState): IdpClient {
  return {
    discover: async () => {
      if (state.discovery === null) throw new Error('oidc-discovery-failed status=404');
      return state.discovery;
    },
    exchangeCode: async (input) => {
      if (state.tokenEndpointFails) throw new OidcLoginError('token-exchange-failed', '换码返回 500');
      state.lastExchange = { code: input.code, codeVerifier: input.codeVerifier, redirectUri: input.redirectUri, clientSecret: input.clientSecret };
      return { accessToken: `access-for-${input.code}`, idToken: state.idToken };
    },
    fetchUserinfo: async (input) => {
      if (state.userinfoFails) throw new OidcLoginError('userinfo-fetch-failed', '读取用户信息返回 503');
      state.lastUserinfo = { endpoint: input.userinfoEndpoint, style: input.requestStyle, clientId: input.clientId, scopes: input.scopes, accessToken: input.accessToken };
      return state.userinfo;
    },
    verifyIdToken: async () => {
      if (state.verified === 'fail') throw new OidcLoginError('id-token-verify-failed', '令牌验签失败');
      return state.verified;
    },
    jwksReachable: async () => state.jwksReachable,
  };
}

/** 不缓存的解析器：缓存纪律另有单测，集成用例要每次看当前配置。 */
export function directResolver(client: IdpClient): EndpointResolver {
  return {
    resolve: async (provider) => {
      const { mergeEndpoints } = await import('../domain/endpointResolution');
      try {
        return mergeEndpoints(await client.discover(provider.issuerUrl), provider, { ok: true });
      } catch (error) {
        return mergeEndpoints(null, provider, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}

/** 供用例断言授权地址里的 PKCE 挑战确实由 verifier 算出。 */
export function challengeMatches(codeVerifier: string, challenge: string): boolean {
  return codeChallengeOf(codeVerifier) === challenge;
}
