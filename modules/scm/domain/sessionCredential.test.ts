import { describe, expect, test } from 'bun:test';
import { credentialExpiry, hashToken, isExpired, remoteExpiryDate, revoke } from './sessionCredential';

describe('sessionCredential', () => {
  const now = new Date('2026-09-11T10:00:00.000Z');

  test('到期时刻 = now + ttl；ttl 必须是合法整数分钟', () => {
    expect(credentialExpiry(now, 30).toISOString()).toBe('2026-09-11T10:30:00.000Z');
    for (const bad of [0, -1, 1.5, 30 * 24 * 60 + 1, Number.NaN]) expect(() => credentialExpiry(now, bad)).toThrow(expect.objectContaining({ kind: 'validation' }));
  });

  test('哈希为 SHA-256 十六进制且不可逆推明文；远端到期日为次日 UTC 日期', () => {
    const hash = hashToken('glpat-abc');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('glpat');
    expect(hash).toBe(hashToken('glpat-abc'));
    expect(remoteExpiryDate(new Date('2026-09-11T23:59:00.000Z'))).toBe('2026-09-12');
  });

  test('isExpired 与 revoke', () => {
    const credential = { id: 'cred_1', serviceId: 'svc_1' as never, remoteTokenId: '1', tokenHash: 'h', expiresAt: new Date('2026-09-11T10:30:00.000Z'), createdAt: now };
    expect(isExpired(credential, now)).toBe(false);
    expect(isExpired(credential, new Date('2026-09-11T10:30:00.000Z'))).toBe(true);
    expect(revoke(credential, now).revokedAt).toEqual(now);
  });
});
