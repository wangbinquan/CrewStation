import { describe, expect, test } from 'bun:test';
import { bootstrapTokenMatches, buildAuthorizeUrl, codeChallengeOf, newOidcFlowSeed, oidcRedirectUri } from './oidcFlow';

describe('登录跳转', () => {
  test('每次都是新的 state／verifier／nonce，challenge 与 verifier 对得上', () => {
    const a = newOidcFlowSeed();
    const b = newOidcFlowSeed();
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.nonce).not.toBe(b.nonce);
    expect(codeChallengeOf(a.codeVerifier)).toBe(a.codeChallenge);
    for (const value of [a.state, a.codeVerifier, a.codeChallenge, a.nonce]) expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('授权地址带齐 PKCE 与 nonce，且保留端点自己的查询串', () => {
    const url = new URL(buildAuthorizeUrl('https://idp.corp.com/authorize?tenant=corp', {
      clientId: 'cs', scopes: 'openid profile', state: 's', codeChallenge: 'c', nonce: 'n', redirectUri: 'http://console.cs.localhost/auth/oidc/corp/callback',
    }));
    expect(url.searchParams.get('tenant')).toBe('corp');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid profile');
    expect(url.searchParams.get('redirect_uri')).toBe('http://console.cs.localhost/auth/oidc/corp/callback');
  });

  test('回调地址由安装配置推出，不读请求 Host——读 Host 等于让伪造的 Host 改写 redirect_uri', () => {
    expect(oidcRedirectUri('https://console.cs.example.com', 'corp-sso')).toBe('https://console.cs.example.com/auth/oidc/corp-sso/callback');
  });
});

describe('引导令牌比较', () => {
  test('相等才通过；空配置、长度不同、前缀相同都不通过', () => {
    expect(bootstrapTokenMatches('token-value', 'token-value')).toBe(true);
    expect(bootstrapTokenMatches('token-value', 'token-valuX')).toBe(false);
    expect(bootstrapTokenMatches('token-value', 'token-value-longer')).toBe(false);
    expect(bootstrapTokenMatches('token-value', 'token')).toBe(false);
    expect(bootstrapTokenMatches(undefined, 'token-value')).toBe(false);
    expect(bootstrapTokenMatches('', 'token-value')).toBe(false);
  });
});
