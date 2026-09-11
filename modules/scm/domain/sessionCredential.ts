import type { ServiceId } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';

/** 会话级短期 Git 凭据：平台只保存哈希与远端令牌 ID，明文在签发响应后不再出现。 */
export interface SessionCredential {
  readonly id: string;
  readonly serviceId: ServiceId;
  readonly remoteTokenId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly revokedAt?: Date;
}

export const MAX_CREDENTIAL_TTL_MINUTES = 30 * 24 * 60;

export function credentialExpiry(now: Date, ttlMinutes: number): Date {
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > MAX_CREDENTIAL_TTL_MINUTES) {
    throw validation(`ttlMinutes 必须是 1–${MAX_CREDENTIAL_TTL_MINUTES} 的整数`, { ttlMinutes });
  }
  return new Date(now.getTime() + ttlMinutes * 60_000);
}

export function hashToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

export function credentialName(id: string): string {
  return `cs-session-${id}`;
}

/** GitLab 令牌到期只有日期精度：远端到期日取平台到期时刻的次日（UTC），平台到期后由 revokeExpiredCredentials 主动撤销。 */
export function remoteExpiryDate(expiresAt: Date): string {
  return new Date(expiresAt.getTime() + 86_400_000).toISOString().slice(0, 10);
}

export function isExpired(credential: SessionCredential, now: Date): boolean {
  return credential.expiresAt.getTime() <= now.getTime();
}

export function revoke(credential: SessionCredential, at: Date): SessionCredential {
  return { ...credential, revokedAt: at };
}
