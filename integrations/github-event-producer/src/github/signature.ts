import { createHmac, timingSafeEqual } from 'node:crypto';

/** GitHub signs the exact body bytes. Never decode or reserialize before verification. */
export function verifySignature(body: Uint8Array, signature: string | null, secret: string | null): { ok: boolean; reason: string } {
  if (!secret || !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return { ok: false, reason: 'Missing secret or valid SHA-256 signature' };
  const expected = createHmac('sha256', secret).update(body).digest();
  const ok = timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
  return { ok, reason: ok ? 'verified' : 'Signature mismatch' };
}
