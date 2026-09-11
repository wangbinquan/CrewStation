import type { JwksDocument } from '@crewstation/contracts';

export type TokenClaimValue = string | number | boolean;

export interface SignTokenInput {
  subject: string;
  audience: string;
  expiresInSeconds: number;
  claims: Record<string, TokenClaimValue>;
}

export interface VerifiedToken {
  subject: string;
  audience: string[];
  expiresAt: number;
  claims: Record<string, unknown>;
}

/** 平台令牌的签发与验签；实现负责密钥的加载、生成与轮换重叠期。 */
export interface TokenService {
  sign(input: SignTokenInput): Promise<string>;
  /** 签名、iss、aud、exp 任一不符返回 undefined；不抛异常也不记录令牌内容。 */
  verify(token: string, expected: { audience: string }): Promise<VerifiedToken | undefined>;
  jwks(): Promise<JwksDocument>;
  /** 生成新钥并把当前钥转入重叠期。 */
  rotate(): Promise<{ kid: string }>;
}
