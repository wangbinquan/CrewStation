import { PlatformError } from '@crewstation/kernel';
import type { SecretCipher } from '../../ports/secretCipher';

const FORMAT = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * AES-256-GCM（WebCrypto）：每个值随机 IV，输出 `v1:<iv>:<密文+认证标签>`（各段 base64）。
 * 密钥来自安装配置（base64 编码的 32 字节）；格式前缀留给日后换密钥或换算法。
 */
export function createAesGcmSecretCipher(keyBase64: string): SecretCipher {
  const raw = decodeKey(keyBase64);
  let key: Promise<CryptoKey> | undefined;
  const cryptoKey = (): Promise<CryptoKey> => (key ??= crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']));
  return {
    encrypt: async (plain) => {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(), new TextEncoder().encode(plain));
      return [FORMAT, toBase64(iv), toBase64(new Uint8Array(sealed))].join(':');
    },
    decrypt: async (value) => {
      const { iv, sealed } = parse(value);
      try {
        return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await cryptoKey(), sealed));
      } catch {
        throw new PlatformError('internal', 'Secret 密文无法解密：密钥不匹配或数据已损坏');
      }
    },
  };
}

function decodeKey(keyBase64: string): Uint8Array<ArrayBuffer> {
  const bytes = fromBase64(keyBase64);
  if (bytes.byteLength !== KEY_BYTES) throw new Error(`Secret 密钥必须是 base64 编码的 ${KEY_BYTES} 字节，实际 ${bytes.byteLength} 字节`);
  return bytes;
}

function parse(value: string): { iv: Uint8Array<ArrayBuffer>; sealed: Uint8Array<ArrayBuffer> } {
  const parts = value.split(':');
  const [format, iv, sealed] = parts;
  if (parts.length !== 3 || format !== FORMAT || !iv || !sealed) throw new PlatformError('internal', 'Secret 密文格式不正确');
  return { iv: fromBase64(iv), sealed: fromBase64(sealed) };
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(text, 'base64'));
}
