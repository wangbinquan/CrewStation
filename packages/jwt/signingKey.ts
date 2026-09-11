import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';
import type { JWK } from 'jose';

/** 平台唯一使用的签名算法；业务验签时也只接受它。 */
export const SIGNING_ALGORITHM = 'ES256';

/**
 * 一把签名密钥的两种 JWK 形态。`privateJwk` 只经 KeyStore 进出，任何日志、错误信息与 API 响应都不得出现它；
 * 对外只发布 `publicJwk`。`kid` 是公钥的 RFC 7638 指纹，同一把钥匙在任何副本上算出的 kid 一致。
 */
export interface SigningKey {
  readonly kid: string;
  readonly privateJwk: JWK;
  readonly publicJwk: JWK;
}

export async function generateSigningKey(): Promise<SigningKey> {
  const { publicKey, privateKey } = await generateKeyPair(SIGNING_ALGORITHM, { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  const common = { kid, alg: SIGNING_ALGORITHM, use: 'sig' } as const;
  return {
    kid,
    publicJwk: { ...publicJwk, ...common },
    privateJwk: { ...(await exportJWK(privateKey)), ...common },
  };
}

/** 判定一个 JWK 是否含私钥材料；序列化校验与“不得外泄”断言都用它。 */
export function holdsPrivateMaterial(jwk: JWK): boolean {
  return typeof jwk.d === 'string' && jwk.d.length > 0;
}
