const PREFIX = 'v1';

/** 生成 32 字节密钥的 base64；写入安装配置，不进入代码或日志。 */
export function generateSecretKey(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = Buffer.from(keyBase64, 'base64');
  if (raw.length !== 32) throw new Error('密钥必须是 32 字节的 base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptString(keyBase64: string, plain: string): Promise<string> {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return `${PREFIX}:${Buffer.from(iv).toString('base64')}:${Buffer.from(cipher).toString('base64')}`;
}

export async function decryptString(keyBase64: string, boxed: string): Promise<string> {
  const [version, ivB64, cipherB64] = boxed.split(':');
  if (version !== PREFIX || !ivB64 || !cipherB64) throw new Error('密文格式不正确');
  const key = await importKey(keyBase64);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(ivB64, 'base64') }, key, Buffer.from(cipherB64, 'base64'));
  return new TextDecoder().decode(plain);
}

export function isSecretBox(value: string): boolean {
  return value.startsWith(`${PREFIX}:`) && value.split(':').length === 3;
}
