/** 一次性 TaskRunner 令牌：随机 32 字节，库里只存 sha256；比较时用常量时间。 */
export function newRunnerToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

export function hashRunnerToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

export function tokenMatches(token: string, hash: string): boolean {
  const a = Buffer.from(hashRunnerToken(token));
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
