import { decryptString, encryptString } from '@crewstation/secretbox';
import type { SecretCipher } from '../../ports/credentials';

/** 平台密钥加解密（与 data 用同一把密钥与同一种密文格式）。 */
export function secretboxCipher(keyBase64: string): SecretCipher {
  return { encrypt: (plain) => encryptString(keyBase64, plain), decrypt: (boxed) => decryptString(keyBase64, boxed) };
}
