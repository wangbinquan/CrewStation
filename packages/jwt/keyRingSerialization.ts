import type { JWK } from 'jose';
import type { KeyRingMaterial } from './keyRing';
import type { SigningKey } from './signingKey';
import { holdsPrivateMaterial } from './signingKey';

export const KEY_RING_FORMAT_VERSION = 1;

/** 存入 KeyStore 的形态；含私钥，只能落到受保护的存储，不能进日志。 */
export function serializeKeyRing(material: KeyRingMaterial): string {
  return JSON.stringify({ version: KEY_RING_FORMAT_VERSION, active: material.active, previous: material.previous });
}

/** 解析失败只报“无法解析”，不回显内容。 */
export function parseKeyRing(serialized: string): KeyRingMaterial {
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new Error('密钥环内容无法解析');
  }
  if (!isRecord(raw) || raw.version !== KEY_RING_FORMAT_VERSION || !Array.isArray(raw.previous)) throw new Error('密钥环格式不正确');
  const active = asSigningKey(raw.active);
  const previous = raw.previous.map(asSigningKey);
  return { active, previous };
}

/** 可安全写入日志的摘要：只有 kid。 */
export function describeKeyRing(material: KeyRingMaterial): { activeKid: string; previousKids: string[] } {
  return { activeKid: material.active.kid, previousKids: material.previous.map((k) => k.kid) };
}

function asSigningKey(value: unknown): SigningKey {
  if (!isRecord(value) || typeof value.kid !== 'string' || value.kid.length === 0) throw new Error('密钥环格式不正确');
  const privateJwk = asEcJwk(value.privateJwk);
  const publicJwk = asEcJwk(value.publicJwk);
  if (!holdsPrivateMaterial(privateJwk) || holdsPrivateMaterial(publicJwk)) throw new Error('密钥环格式不正确');
  return { kid: value.kid, privateJwk, publicJwk };
}

function asEcJwk(value: unknown): JWK {
  if (!isRecord(value) || value.kty !== 'EC' || value.crv !== 'P-256' || typeof value.x !== 'string' || typeof value.y !== 'string') {
    throw new Error('密钥环格式不正确');
  }
  return value as JWK;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
