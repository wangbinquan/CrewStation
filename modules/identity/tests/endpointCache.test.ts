import { describe, expect, test } from 'bun:test';
import { cachedEndpointResolver } from '../adapters/idp/cachedEndpointResolver';
import type { DiscoveryDocument } from '../domain/endpointResolution';
import type { IdpClient } from '../ports/idpClient';

const ISSUER = 'https://idp.corp.example';
const FULL: DiscoveryDocument = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/jwks`,
};
const manualComplete = {
  issuerUrl: ISSUER,
  authorizationEndpoint: `${ISSUER}/m/authorize`,
  tokenEndpoint: `${ISSUER}/m/token`,
  userinfoEndpoint: `${ISSUER}/m/userinfo`,
  jwksUri: null,
  subjectClaim: null, usernameClaim: null, emailClaim: null, gitNameClaim: null,
};
const noManual = { ...manualComplete, authorizationEndpoint: null, tokenEndpoint: null, userinfoEndpoint: null };

interface Counter { calls: number; fail: boolean; doc: DiscoveryDocument }

function client(counter: Counter): IdpClient {
  return {
    discover: async () => {
      counter.calls++;
      if (counter.fail) throw new Error('oidc-discovery-failed status=500');
      return counter.doc;
    },
    exchangeCode: async () => { throw new Error('未使用'); },
    fetchUserinfo: async () => { throw new Error('未使用'); },
    verifyIdToken: async () => { throw new Error('未使用'); },
    jwksReachable: async () => true,
  };
}

/** 受控时钟：缓存过期全靠它推进，不靠真实等待。 */
function clockAt(start: number) {
  let current = start;
  return { clock: { now: () => new Date(current) }, advance: (ms: number) => { current += ms; } };
}

describe('端点解析的缓存纪律', () => {
  test('成功的 discovery 在一小时内只取一次，过期后再取', () => {
    const counter: Counter = { calls: 0, fail: false, doc: FULL };
    const { clock, advance } = clockAt(0);
    const resolver = cachedEndpointResolver(client(counter), clock);
    return (async () => {
      expect((await resolver.resolve(noManual)).authorizationEndpoint).toBe(`${ISSUER}/authorize`);
      await resolver.resolve(noManual);
      expect(counter.calls).toBe(1);
      advance(60 * 60 * 1000 + 1);
      await resolver.resolve(noManual);
      expect(counter.calls).toBe(2);
    })();
  });

  test('失败只按失败缓存，且只在手工端点能撑起一次登录时才缓存', async () => {
    const counter: Counter = { calls: 0, fail: true, doc: FULL };
    const { clock } = clockAt(0);
    const withManual = cachedEndpointResolver(client(counter), clock);
    const first = await withManual.resolve(manualComplete);
    expect(first.discoveryOk).toBe(false);
    expect(first.tokenEndpoint).toBe(`${ISSUER}/m/token`);
    await withManual.resolve(manualComplete);
    // 手工端点齐全 → 失败被缓存，五分钟内不再去打一个已知坏掉的 IdP。
    expect(counter.calls).toBe(1);

    const bare: Counter = { calls: 0, fail: true, doc: FULL };
    const withoutManual = cachedEndpointResolver(client(bare), clockAt(0).clock);
    await withoutManual.resolve(noManual);
    await withoutManual.resolve(noManual);
    // 没有手工端点时不缓存失败：否则一次瞬时故障会变成五分钟不可登录，IdP 恢复也看不见。
    expect(bare.calls).toBe(2);
  });

  test('缓存命中不可登录时按未命中处理：半可用的组合绝不从缓存返回', async () => {
    const counter: Counter = { calls: 0, fail: false, doc: { issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize` } };
    const resolver = cachedEndpointResolver(client(counter), clockAt(0).clock);
    await resolver.resolve(noManual);
    await resolver.resolve(noManual);
    expect(counter.calls).toBe(2);
  });

  test('新的失败会清掉旧的成功条目：负缓存过期后不能复活一小时前的端点', async () => {
    const counter: Counter = { calls: 0, fail: false, doc: FULL };
    const { clock, advance } = clockAt(0);
    const resolver = cachedEndpointResolver(client(counter), clock);
    expect((await resolver.resolve(manualComplete)).sources.tokenEndpoint).toBe('discovery');
    counter.fail = true;
    advance(60 * 60 * 1000 + 1);
    expect((await resolver.resolve(manualComplete)).sources.tokenEndpoint).toBe('manual');
    counter.fail = false;
    advance(5 * 60 * 1000 + 1);
    // 负缓存过期后重新取用，而不是拿出那份早已过期的成功文档。
    expect((await resolver.resolve(manualComplete)).sources.tokenEndpoint).toBe('discovery');
    expect(counter.calls).toBe(3);
  });

  test('测试连接强制取新，并用新结果回填缓存', async () => {
    const counter: Counter = { calls: 0, fail: false, doc: FULL };
    const resolver = cachedEndpointResolver(client(counter), clockAt(0).clock);
    await resolver.resolve(noManual);
    await resolver.resolve(noManual, { forceFresh: true });
    expect(counter.calls).toBe(2);
    await resolver.resolve(noManual);
    expect(counter.calls).toBe(2);
  });
});
