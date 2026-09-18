import { decryptString, encryptString } from '@crewstation/secretbox';
import type { SecretCipher } from '../../ports/secretCipher';

/** 没有安装密钥时一切封存操作直接失败——宁可管不了 Provider，也不要把凭据落成明文。 */
export function secretBoxCipher(secretKeyBase64: string | undefined): SecretCipher {
  const key = (): string => {
    if (!secretKeyBase64) throw new Error('缺少安装密钥 CS_SECRET_KEY，无法封存身份提供方凭据');
    return secretKeyBase64;
  };
  return {
    seal: (plaintext) => encryptString(key(), plaintext),
    open: (boxed) => decryptString(key(), boxed),
  };
}
