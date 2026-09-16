import { decryptString, encryptString } from '@crewstation/secretbox';
import type { SecretCipher } from '../../ports/secretCipher';

/** 复用平台安装密钥与 SecretBox（AES-256-GCM），不另起一套密钥体系（RFC-004 §3）。 */
export function secretboxCipher(keyBase64: string): SecretCipher {
  return { encrypt: (plain) => encryptString(keyBase64, plain), decrypt: (cipher) => decryptString(keyBase64, cipher) };
}
