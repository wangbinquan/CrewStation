import { describe, expect, test } from 'bun:test';
import { createAesGcmSecretCipher } from './aesGcmSecretCipher';

const keyOf = (bytes: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64');

describe('AES-256-GCM secret cipher', () => {
  test('往返一致；同一明文两次加密密文不同（随机 IV）；输出 v1:<iv>:<密文>', async () => {
    const cipher = createAesGcmSecretCipher(keyOf(32));
    const a = await cipher.encrypt('s3cret 值');
    const b = await cipher.encrypt('s3cret 值');
    expect(a).not.toBe(b);
    expect(a.split(':')).toHaveLength(3);
    expect(a.startsWith('v1:')).toBe(true);
    expect(a).not.toContain('s3cret');
    expect(await cipher.decrypt(a)).toBe('s3cret 值');
    expect(await cipher.decrypt(b)).toBe('s3cret 值');
    expect(await cipher.decrypt(await cipher.encrypt(''))).toBe('');
  });

  test('篡改、换密钥、格式错误都被拒绝', async () => {
    const cipher = createAesGcmSecretCipher(keyOf(32));
    const sealed = await cipher.encrypt('payload');
    const [format, iv, data] = sealed.split(':') as [string, string, string];
    const flipped = Buffer.from(data, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    await expect(cipher.decrypt([format, iv, flipped.toString('base64')].join(':'))).rejects.toMatchObject({ kind: 'internal' });
    await expect(createAesGcmSecretCipher(keyOf(32)).decrypt(sealed)).rejects.toMatchObject({ kind: 'internal' });
    await expect(cipher.decrypt('v0:abc:def')).rejects.toMatchObject({ kind: 'internal' });
    await expect(cipher.decrypt('plain')).rejects.toMatchObject({ kind: 'internal' });
  });

  test('密钥必须是 32 字节', () => {
    expect(() => createAesGcmSecretCipher(keyOf(16))).toThrow('32');
    expect(() => createAesGcmSecretCipher('')).toThrow('32');
  });
});
