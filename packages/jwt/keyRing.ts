import type { Clock } from '@crewstation/kernel';
import { SignJWT, createLocalJWKSet, errors, importJWK, jwtVerify } from 'jose';
import type { CryptoKey, JSONWebKeySet, JWTPayload, JWTVerifyGetKey } from 'jose';
import type { SigningKey } from './signingKey';
import { SIGNING_ALGORITHM } from './signingKey';
import { TokenVerificationError } from './verificationError';

/** 密钥环：一把在用的签名钥 + 若干仍可验签的旧钥（轮换重叠期，Design §12）。 */
export interface KeyRingMaterial {
  readonly active: SigningKey;
  readonly previous: readonly SigningKey[];
}

export interface KeyRingOptions {
  /** 写入并校验 `iss`；不给则不设也不校验。 */
  issuer?: string;
  clock?: Clock;
}

export type TokenClaims = Record<string, string | number | boolean | string[]>;

export interface SignOptions {
  audience: string | string[];
  subject: string;
  expiresInSeconds: number;
}

export interface VerifyOptions {
  audience: string | string[];
}

export interface VerifiedToken {
  subject: string;
  audience: string[];
  issuedAt: number;
  expiresAt: number;
  kid: string;
  claims: JWTPayload;
}

export interface KeyRing {
  readonly activeKid: string;
  /** 在用钥在前，旧钥按加入顺序在后。 */
  readonly kids: readonly string[];
  sign(claims: TokenClaims, options: SignOptions): Promise<string>;
  /** 签名、iss、aud、exp 任一不符抛 TokenVerificationError。 */
  verify(token: string, options: VerifyOptions): Promise<VerifiedToken>;
  /** 在用钥与旧钥的公钥；旧钥保留在此直到重叠期结束。 */
  jwks(): JSONWebKeySet;
}

export function createKeyRing(material: KeyRingMaterial, options: KeyRingOptions = {}): KeyRing {
  const now = (): Date => options.clock?.now() ?? new Date();
  const keySet: JSONWebKeySet = { keys: [material.active.publicJwk, ...material.previous.map((k) => k.publicJwk)] };
  const resolver = createLocalJWKSet(keySet);
  let privateKey: Promise<CryptoKey> | undefined;
  const signingKey = (): Promise<CryptoKey> => {
    privateKey ??= importJWK(material.active.privateJwk, SIGNING_ALGORITHM).then((key) => {
      if (key instanceof Uint8Array) throw new Error('签名密钥必须是非对称密钥');
      return key;
    });
    return privateKey;
  };
  return {
    activeKid: material.active.kid,
    kids: [material.active.kid, ...material.previous.map((k) => k.kid)],
    sign: async (claims, sign) => {
      const issuedAt = Math.floor(now().getTime() / 1000);
      const jwt = new SignJWT(claims)
        .setProtectedHeader({ alg: SIGNING_ALGORITHM, kid: material.active.kid, typ: 'JWT' })
        .setSubject(sign.subject)
        .setAudience(sign.audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + sign.expiresInSeconds)
        .setJti(crypto.randomUUID());
      if (options.issuer) jwt.setIssuer(options.issuer);
      return jwt.sign(await signingKey());
    },
    verify: (token, verify) => verifyWith(resolver, token, { ...verify, issuer: options.issuer, currentDate: now() }),
    jwks: () => ({ keys: keySet.keys.map((k) => ({ ...k })) }),
  };
}

/** 用一份 JWKS 文档验签：业务服务与测试用它对着 `/.well-known/jwks.json` 校验平台令牌。 */
export function verifyWithJwks(token: string, jwks: JSONWebKeySet, options: VerifyOptions & { issuer?: string; currentDate?: Date }): Promise<VerifiedToken> {
  return verifyWith(createLocalJWKSet(jwks), token, options);
}

async function verifyWith(resolver: JWTVerifyGetKey, token: string, options: VerifyOptions & { issuer?: string; currentDate?: Date }): Promise<VerifiedToken> {
  try {
    const { payload, protectedHeader } = await jwtVerify(token, resolver, {
      algorithms: [SIGNING_ALGORITHM],
      typ: 'JWT',
      audience: options.audience,
      ...(options.issuer ? { issuer: options.issuer } : {}),
      ...(options.currentDate ? { currentDate: options.currentDate } : {}),
      requiredClaims: ['sub', 'iat', 'exp'],
    });
    return {
      subject: payload.sub ?? '',
      audience: Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [],
      issuedAt: payload.iat ?? 0,
      expiresAt: payload.exp ?? 0,
      kid: protectedHeader.kid ?? '',
      claims: payload,
    };
  } catch (error) {
    throw toVerificationError(error);
  }
}

function toVerificationError(error: unknown): TokenVerificationError {
  if (error instanceof errors.JWTExpired) return new TokenVerificationError('expired', '令牌已过期');
  if (error instanceof errors.JWTClaimValidationFailed) return new TokenVerificationError('claims', `令牌声明 ${error.claim} 不符合预期`);
  if (error instanceof errors.JWKSNoMatchingKey) return new TokenVerificationError('unknown-key', '令牌使用的密钥不在密钥环中');
  if (error instanceof errors.JWSSignatureVerificationFailed) return new TokenVerificationError('signature', '令牌签名无效');
  if (error instanceof errors.JOSEError) return new TokenVerificationError('malformed', '令牌格式不正确');
  throw error;
}

/** 轮换：新钥成为在用钥，原在用钥进入旧钥列表；旧钥最多保留 keepPrevious 把。 */
export function rotateKeyRing(material: KeyRingMaterial, next: SigningKey, keepPrevious = 2): KeyRingMaterial {
  return { active: next, previous: [material.active, ...material.previous].slice(0, keepPrevious) };
}
