/** Bounded decoding of Garage's rmp-serde values. No extensions, coercion,
 * duplicate map keys or trailing bytes can produce an apparently empty record. */
export function decodeGarageMessagePack(raw: Uint8Array): unknown {
  if (!raw.byteLength || raw.byteLength > 8_388_608) throw Error('garage-native-row-budget');
  const data = new DataView(raw.buffer, raw.byteOffset, raw.byteLength); let at = 0, nodes = 0;
  const take = (size: number) => {
    if (!Number.isSafeInteger(size) || size < 0 || at + size > raw.byteLength) throw Error('garage-native-truncated-row');
    const begin = at; at += size; return begin;
  };
  const integer = (size: number, signed = false) => {
    const offset = take(size);
    if (size === 1) return signed ? data.getInt8(offset) : data.getUint8(offset);
    if (size === 2) return signed ? data.getInt16(offset) : data.getUint16(offset);
    if (size === 4) return signed ? data.getInt32(offset) : data.getUint32(offset);
    const value = signed ? data.getBigInt64(offset) : data.getBigUint64(offset);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value;
  };
  const bytes = (size: number) => { const offset = take(size); return raw.slice(offset, offset + size); };
  const text = (size: number) => new TextDecoder('utf-8', { fatal: true }).decode(bytes(size));
  const length = (size: number) => Number(integer(size));
  const array = (size: number, depth: number) => {
    if (size > 100_000) throw Error('garage-native-array-budget'); return Array.from({ length: size }, () => value(depth + 1));
  };
  const map = (size: number, depth: number) => {
    if (size > 100_000) throw Error('garage-native-map-budget'); const result: Record<string, unknown> = Object.create(null);
    for (let i = 0; i < size; i++) {
      const key = value(depth + 1); if (typeof key !== 'string' || Object.hasOwn(result, key)) throw Error('garage-native-map-key');
      result[key] = value(depth + 1);
    } return result;
  };
  const value = (depth: number): unknown => {
    if (depth > 64 || ++nodes > 1_000_000) throw Error('garage-native-structure-budget');
    const tag = Number(integer(1));
    if (tag <= 0x7f) return tag;
    if (tag >= 0xe0) return tag - 256;
    if ((tag & 0xe0) === 0xa0) return text(tag & 0x1f);
    if ((tag & 0xf0) === 0x90) return array(tag & 0x0f, depth);
    if ((tag & 0xf0) === 0x80) return map(tag & 0x0f, depth);
    if (tag === 0xc0) return null;
    if (tag === 0xc2 || tag === 0xc3) return tag === 0xc3;
    if (tag >= 0xc4 && tag <= 0xc6) return bytes(length(2 ** (tag - 0xc4)));
    if (tag === 0xca) return data.getFloat32(take(4));
    if (tag === 0xcb) return data.getFloat64(take(8));
    if (tag >= 0xcc && tag <= 0xcf) return integer(2 ** (tag - 0xcc));
    if (tag >= 0xd0 && tag <= 0xd3) return integer(2 ** (tag - 0xd0), true);
    if (tag >= 0xd9 && tag <= 0xdb) return text(length(2 ** (tag - 0xd9)));
    if (tag === 0xdc || tag === 0xdd) return array(length(tag === 0xdc ? 2 : 4), depth);
    if (tag === 0xde || tag === 0xdf) return map(length(tag === 0xde ? 2 : 4), depth);
    throw Error('garage-native-unsupported-format');
  };
  const result = value(0); if (at !== raw.byteLength) throw Error('garage-native-trailing-bytes'); return result;
}

export const garageNativeId = (value: unknown): string => {
  const bytes = value instanceof Uint8Array ? value : Array.isArray(value) && value.every(row => Number.isInteger(row) && row >= 0 && row <= 255) ? Uint8Array.from(value) : undefined;
  if (bytes?.length !== 32) throw Error('garage-native-invalid-identity'); return Buffer.from(bytes).toString('hex');
};
export const garageNativeRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) throw Error('garage-native-invalid-record');
  return value as Record<string, unknown>;
};
