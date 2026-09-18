import { describe, expect, test } from 'bun:test';
import { loginViable, mergeEndpoints, sanitizeEndpointUrl } from './endpointResolution';

const manual = {
  issuerUrl: 'https://idp.corp.com',
  authorizationEndpoint: 'https://idp.corp.com/m/authorize',
  tokenEndpoint: 'https://idp.corp.com/m/token',
  userinfoEndpoint: 'https://idp.corp.com/m/userinfo',
  jwksUri: 'https://idp.corp.com/m/jwks',
  subjectClaim: null, usernameClaim: null, emailClaim: null, gitNameClaim: null,
};
const bare = { ...manual, authorizationEndpoint: null, tokenEndpoint: null, userinfoEndpoint: null, jwksUri: null };

describe('端点解析', () => {
  test('discovery 覆盖手工值，缺的字段逐个回落，来源逐项可辨', () => {
    const merged = mergeEndpoints({ authorization_endpoint: 'https://idp.corp.com/d/authorize', token_endpoint: 'https://idp.corp.com/d/token' }, manual, { ok: true });
    expect(merged.authorizationEndpoint).toBe('https://idp.corp.com/d/authorize');
    expect(merged.sources.authorizationEndpoint).toBe('discovery');
    expect(merged.userinfoEndpoint).toBe('https://idp.corp.com/m/userinfo');
    expect(merged.sources.userinfoEndpoint).toBe('manual');
  });

  test('坏的 discovery 字段不许盖掉对的手工值：脏值会一路走到登录路径上的 new URL', () => {
    for (const bad of ['', 'javascript:alert(1)', 'not a url', 'ftp://x/y']) expect(sanitizeEndpointUrl(bad)).toBeNull();
    expect(sanitizeEndpointUrl(42)).toBeNull();
    const merged = mergeEndpoints({ authorization_endpoint: '', token_endpoint: 'javascript:alert(1)' }, manual, { ok: true });
    expect(merged.authorizationEndpoint).toBe('https://idp.corp.com/m/authorize');
    expect(merged.tokenEndpoint).toBe('https://idp.corp.com/m/token');
    expect(merged.sources.tokenEndpoint).toBe('manual');
  });

  test('issuer 取文档值且不去尾斜杠：OIDC 的 iss 比较是精确相等', () => {
    expect(mergeEndpoints({ issuer: 'https://idp.corp.com/' }, manual, { ok: true }).issuer).toBe('https://idp.corp.com/');
    expect(mergeEndpoints({ issuer: '' }, { ...manual, issuerUrl: 'https://idp.corp.com/' }, { ok: true }).issuer).toBe('https://idp.corp.com/');
    expect(mergeEndpoints(null, manual, { ok: false, error: 'oidc-discovery-failed status=500' }).discoveryError).toBe('oidc-discovery-failed status=500');
  });

  test('scopes_supported 只收字符串项，非数组按空处理', () => {
    expect(mergeEndpoints({ scopes_supported: ['openid', 7, 'email'] }, manual, { ok: true }).scopesSupported).toEqual(['openid', 'email']);
    expect(mergeEndpoints({ scopes_supported: 'openid' }, manual, { ok: true }).scopesSupported).toEqual([]);
  });

  test('可登录判定：跳转与换码必须有，身份通道二者有一即可', () => {
    expect(loginViable({ authorizationEndpoint: 'a', tokenEndpoint: 't', userinfoEndpoint: 'u', jwksUri: null }, manual)).toBe(true);
    expect(loginViable({ authorizationEndpoint: 'a', tokenEndpoint: 't', userinfoEndpoint: null, jwksUri: 'j' }, manual)).toBe(true);
    expect(loginViable({ authorizationEndpoint: 'a', tokenEndpoint: 't', userinfoEndpoint: null, jwksUri: null }, manual)).toBe(false);
    expect(loginViable({ authorizationEndpoint: null, tokenEndpoint: 't', userinfoEndpoint: 'u', jwksUri: 'j' }, manual)).toBe(false);
  });

  test('配了任一字段选择器后，身份只能来自 userinfo，JWKS 不算身份通道', () => {
    const withSelector = { ...manual, subjectClaim: 'id' };
    expect(loginViable({ authorizationEndpoint: 'a', tokenEndpoint: 't', userinfoEndpoint: null, jwksUri: 'j' }, withSelector)).toBe(false);
    expect(loginViable({ authorizationEndpoint: 'a', tokenEndpoint: 't', userinfoEndpoint: 'u', jwksUri: null }, withSelector)).toBe(true);
    for (const key of ['usernameClaim', 'emailClaim', 'gitNameClaim'] as const) {
      expect(loginViable({ authorizationEndpoint: 'a', tokenEndpoint: 't', userinfoEndpoint: null, jwksUri: 'j' }, { ...manual, [key]: 'x' })).toBe(false);
    }
  });

  test('完全没有手工值且 discovery 失败：什么都不可用，缓存层据此不缓存失败', () => {
    const merged = mergeEndpoints(null, bare, { ok: false, error: 'boom' });
    expect(merged.authorizationEndpoint).toBeNull();
    expect(merged.sources.jwksUri).toBe('none');
    expect(loginViable(merged, bare)).toBe(false);
  });
});
