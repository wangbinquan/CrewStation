import { decryptString, encryptString } from '@crewstation/secretbox';
import type { SecretCipher } from '../../ports/providers';

export function secretboxCipher(keyBase64: string): SecretCipher {
  return { encrypt: (plain) => encryptString(keyBase64, plain), decrypt: (boxed) => decryptString(keyBase64, boxed) };
}
