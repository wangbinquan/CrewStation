import type { JWTPayload, JWTVerifyGetKey } from 'jose';
import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * 第三方 IdP 的 id_token 验签。与 keyRing 的 `verifyWithJwks` 分开是必须的：
 * 那条路锁定平台自己的 ES256 与 `requiredClaims`，而企业 IdP 多用 RS256，还要额外核 nonce。
 */
const remoteSets = new Map<string, JWTVerifyGetKey>();

/** 按 jwks_uri 复用 jose 的 RemoteJWKSet 实例——它自带密钥缓存与取用冷却，换实例等于放弃这套机制。 */
export function createRemoteJwks(jwksUri: string): JWTVerifyGetKey {
  const existing = remoteSets.get(jwksUri);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(jwksUri));
  remoteSets.set(jwksUri, created);
  return created;
}

export function clearRemoteJwksCache(): void {
  remoteSets.clear();
}

export interface VerifyIdTokenInput {
  readonly idToken: string;
  readonly jwks: JWTVerifyGetKey;
  readonly issuer: string;
  readonly audience: string;
  /** 发起登录时生成的 nonce；缺失或不符都判失败，不接受「IdP 没回 nonce」。 */
  readonly nonce: string;
}

export async function verifyIdToken(input: VerifyIdTokenInput): Promise<JWTPayload> {
  const { payload } = await jwtVerify(input.idToken, input.jwks, { issuer: input.issuer, audience: input.audience });
  if (typeof payload.nonce !== 'string') throw new Error('id_token 缺少 nonce');
  if (payload.nonce !== input.nonce) throw new Error('id_token 的 nonce 与本次登录不符');
  return payload;
}
