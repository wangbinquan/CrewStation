import { describe, expect, test } from 'bun:test';
import { decryptString, encryptString, generateSecretKey, isSecretBox } from './secretbox';

describe('secretbox', () => {
  test('加密后可解密，同一明文两次密文不同，错密钥失败', async () => {
    const key = generateSecretKey();
    const a = await encryptString(key, '秘密');
    const b = await encryptString(key, '秘密');
    expect(a).not.toBe(b);
    expect(isSecretBox(a)).toBe(true);
    expect(await decryptString(key, a)).toBe('秘密');
    await expect(decryptString(generateSecretKey(), a)).rejects.toThrow();
  });
});
