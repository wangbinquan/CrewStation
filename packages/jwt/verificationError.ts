/** 验签失败的分类；调用方按它决定是“重新登录”还是“重新拉取密钥”。 */
export type TokenVerificationReason = 'malformed' | 'signature' | 'expired' | 'claims' | 'unknown-key';

/** 错误信息只描述原因，永不包含令牌内容或密钥材料。 */
export class TokenVerificationError extends Error {
  constructor(readonly reason: TokenVerificationReason, message: string) {
    super(message);
    this.name = 'TokenVerificationError';
  }
}

export function isTokenVerificationError(error: unknown): error is TokenVerificationError {
  return error instanceof TokenVerificationError;
}
