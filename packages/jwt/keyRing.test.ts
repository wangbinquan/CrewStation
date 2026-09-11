import { describe, expect, test } from 'bun:test';
import { fixedClock } from '@crewstation/kernel';
import { createKeyRing, rotateKeyRing, verifyWithJwks } from './keyRing';
import { describeKeyRing, parseKeyRing, serializeKeyRing } from './keyRingSerialization';
import { generateSigningKey, holdsPrivateMaterial } from './signingKey';
import { TokenVerificationError } from './verificationError';

const issuer = 'test-issuer';

async function failure(run: () => Promise<unknown>): Promise<TokenVerificationError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof TokenVerificationError) return error;
    throw error;
  }
  throw new Error('expected verification to fail');
}

describe('signing key', () => {
  test('ES256 密钥：kid 为公钥指纹，公钥不含私钥材料，两种形态都带 kid/alg/use', async () => {
    const key = await generateSigningKey();
    expect(key.kid.length).toBeGreaterThan(20);
    expect(holdsPrivateMaterial(key.privateJwk)).toBe(true);
    expect(holdsPrivateMaterial(key.publicJwk)).toBe(false);
    expect(key.publicJwk).toMatchObject({ kty: 'EC', crv: 'P-256', kid: key.kid, alg: 'ES256', use: 'sig' });
    expect(key.privateJwk).toMatchObject({ kid: key.kid, alg: 'ES256' });
  });
});

describe('key ring', () => {
  test('签发后可验签：sub、aud、exp、kid 与自定义声明齐全', async () => {
    const active = await generateSigningKey();
    const clock = fixedClock('2026-09-11T00:00:00Z');
    const ring = createKeyRing({ active, previous: [] }, { issuer, clock });
    const token = await ring.sign({ cs_kind: 'user', name: '演示' }, { subject: 'user:usr_1', audience: 'console', expiresInSeconds: 60 });
    const verified = await ring.verify(token, { audience: 'console' });
    const issuedAt = Math.floor(clock.now().getTime() / 1000);
    expect(verified).toMatchObject({ subject: 'user:usr_1', audience: ['console'], kid: active.kid, issuedAt, expiresAt: issuedAt + 60 });
    expect(verified.claims).toMatchObject({ iss: issuer, cs_kind: 'user', name: '演示' });
    expect(typeof verified.claims.jti).toBe('string');
  });

  test('验签失败按原因分类：aud、过期、篡改、未知密钥、非法格式', async () => {
    const active = await generateSigningKey();
    const clock = fixedClock('2026-09-11T00:00:00Z');
    const ring = createKeyRing({ active, previous: [] }, { issuer, clock });
    const token = await ring.sign({}, { subject: 'user:usr_1', audience: 'console', expiresInSeconds: 60 });
    expect((await failure(() => ring.verify(token, { audience: 'service:x/y' }))).reason).toBe('claims');
    const later = createKeyRing({ active, previous: [] }, { issuer, clock: fixedClock('2026-09-11T00:02:00Z') });
    expect((await failure(() => later.verify(token, { audience: 'console' }))).reason).toBe('expired');
    const [h, p, s] = token.split('.') as [string, string, string];
    const flipped = `${s.slice(0, 10)}${s[10] === 'A' ? 'B' : 'A'}${s.slice(11)}`;
    expect((await failure(() => ring.verify(`${h}.${p}.${flipped}`, { audience: 'console' }))).reason).toBe('signature');
    const stranger = createKeyRing({ active: await generateSigningKey(), previous: [] }, { issuer, clock });
    expect((await failure(() => stranger.verify(token, { audience: 'console' }))).reason).toBe('unknown-key');
    expect((await failure(() => ring.verify('not-a-token', { audience: 'console' }))).reason).toBe('malformed');
    const otherIssuer = createKeyRing({ active, previous: [] }, { issuer: 'someone-else', clock });
    expect((await failure(() => otherIssuer.verify(token, { audience: 'console' }))).reason).toBe('claims');
  });

  test('轮换重叠期：旧钥签的令牌在新环上仍可验签，JWKS 同时发布两把公钥，只剩新钥时才失效', async () => {
    const first = await generateSigningKey();
    const second = await generateSigningKey();
    const ring1 = createKeyRing({ active: first, previous: [] }, { issuer });
    const old = await ring1.sign({}, { subject: 'service:demo/demo', audience: 'platform-api', expiresInSeconds: 60 });
    const rotated = rotateKeyRing({ active: first, previous: [] }, second);
    const ring2 = createKeyRing(rotated, { issuer });
    expect(ring2.kids).toEqual([second.kid, first.kid]);
    expect((await ring2.verify(old, { audience: 'platform-api' })).kid).toBe(first.kid);
    const fresh = await ring2.sign({}, { subject: 'service:demo/demo', audience: 'platform-api', expiresInSeconds: 60 });
    expect((await ring2.verify(fresh, { audience: 'platform-api' })).kid).toBe(second.kid);
    expect(ring2.jwks().keys.map((k) => k.kid)).toEqual([second.kid, first.kid]);
    expect(ring2.jwks().keys.some(holdsPrivateMaterial)).toBe(false);
    const onlyNew = createKeyRing({ active: second, previous: [] }, { issuer });
    expect((await failure(() => onlyNew.verify(old, { audience: 'platform-api' }))).reason).toBe('unknown-key');
    const third = await generateSigningKey();
    expect(rotateKeyRing(rotated, third, 1).previous.map((k) => k.kid)).toEqual([second.kid]);
  });

  test('verifyWithJwks：业务侧只凭 JWKS 文档即可验签', async () => {
    const ring = createKeyRing({ active: await generateSigningKey(), previous: [] }, { issuer });
    const token = await ring.sign({ cs_project: 'demo' }, { subject: 'user:usr_1', audience: 'service:demo/demo', expiresInSeconds: 60 });
    const verified = await verifyWithJwks(token, ring.jwks(), { audience: 'service:demo/demo', issuer });
    expect(verified.claims.cs_project).toBe('demo');
    expect((await failure(() => verifyWithJwks(token, ring.jwks(), { audience: 'console', issuer }))).reason).toBe('claims');
  });

  test('环对象本身不暴露私钥：JSON 化只剩 kid', async () => {
    const active = await generateSigningKey();
    const ring = createKeyRing({ active, previous: [] }, { issuer });
    const dumped = JSON.stringify(ring);
    expect(dumped).toContain(active.kid);
    expect(dumped).not.toContain(active.privateJwk.d as string);
  });
});

describe('key ring serialization', () => {
  test('序列化后可还原并继续验签；摘要只含 kid', async () => {
    const active = await generateSigningKey();
    const previous = await generateSigningKey();
    const material = { active, previous: [previous] };
    const restored = parseKeyRing(serializeKeyRing(material));
    expect(restored.active.kid).toBe(active.kid);
    expect(restored.previous.map((k) => k.kid)).toEqual([previous.kid]);
    const token = await createKeyRing(material, { issuer }).sign({}, { subject: 'user:usr_1', audience: 'session', expiresInSeconds: 60 });
    expect((await createKeyRing(restored, { issuer }).verify(token, { audience: 'session' })).subject).toBe('user:usr_1');
    const summary = JSON.stringify(describeKeyRing(material));
    expect(summary).toBe(JSON.stringify({ activeKid: active.kid, previousKids: [previous.kid] }));
    expect(summary).not.toContain(active.privateJwk.d as string);
  });

  test('拒绝无法解析、缺私钥或公钥带私钥的内容，且不回显内容', async () => {
    const active = await generateSigningKey();
    expect(() => parseKeyRing('{ nope')).toThrow('密钥环内容无法解析');
    expect(() => parseKeyRing(JSON.stringify({ version: 1, active: { kid: 'k', privateJwk: active.publicJwk, publicJwk: active.publicJwk }, previous: [] }))).toThrow('密钥环格式不正确');
    expect(() => parseKeyRing(JSON.stringify({ version: 1, active: { kid: 'k', privateJwk: active.privateJwk, publicJwk: active.privateJwk }, previous: [] }))).toThrow('密钥环格式不正确');
    expect(() => parseKeyRing(JSON.stringify({ version: 2, active, previous: [] }))).toThrow('密钥环格式不正确');
    try {
      parseKeyRing(JSON.stringify({ version: 1, active: { kid: 'k', privateJwk: active.privateJwk, publicJwk: active.privateJwk }, previous: [] }));
    } catch (error) {
      expect(String(error)).not.toContain(active.privateJwk.d as string);
    }
  });
});
