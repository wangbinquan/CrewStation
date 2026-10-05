/** Bounded wire reader for the pinned BuildKit 0.33 Control protocol. Unknown
 * fields are skipped without decoding descriptions, commands or credentials. */
export interface ProtoField { readonly number: number; readonly wire: number; readonly value: bigint | Uint8Array }
const MAX_MESSAGE = 8_388_608;

function varint(bytes: Uint8Array, start: number) {
  let value = 0n;
  for (let index = 0; index < 10; index++) {
    const byte = bytes[start + index];
    if (byte === undefined || index === 9 && byte > 1) throw Error('Native protobuf integer is truncated or overflowed');
    value |= BigInt(byte & 127) << BigInt(index * 7);
    if (byte < 128) {
      if (index && byte === 0) throw Error('Native protobuf integer is not canonical');
      return { value, end: start + index + 1 };
    }
  }
  throw Error('Native protobuf integer is overflowed');
}
export function protoFields(raw: Uint8Array): ProtoField[] {
  if (raw.byteLength > MAX_MESSAGE) throw Error('Native protobuf message exceeds its budget');
  const fields: ProtoField[] = []; let offset = 0;
  while (offset < raw.length) {
    const tag = varint(raw, offset); offset = tag.end;
    const wire = Number(tag.value & 7n), number = Number(tag.value >> 3n);
    if (!number || number > 536_870_911) throw Error('Native protobuf field number is invalid');
    if (wire === 0) { const item = varint(raw, offset); offset = item.end; fields.push({ number, wire, value: item.value }); }
    else if (wire === 1 || wire === 2 || wire === 5) {
      let length = wire === 1 ? 8 : 4;
      if (wire === 2) { const item = varint(raw, offset); offset = item.end; if (item.value > BigInt(MAX_MESSAGE)) throw Error('Native protobuf field exceeds its budget'); length = Number(item.value); }
      if (offset + length > raw.length) throw Error('Native protobuf field is truncated');
      fields.push({ number, wire, value: raw.subarray(offset, offset + length) }); offset += length;
    } else throw Error('Native protobuf wire type is unsupported');
    if (fields.length > 100_000) throw Error('Native protobuf field budget exceeded');
  }
  return fields;
}
export function protoOne(fields: readonly ProtoField[], number: number, wire: number, required = false) {
  const rows = fields.filter(row => row.number === number);
  if (rows.length > 1 || required && !rows.length || rows.some(row => row.wire !== wire)) throw Error('Native protobuf singular field is missing, repeated or has the wrong wire type');
  return rows[0]?.value;
}
export function protoBytes(fields: readonly ProtoField[], number: number, required = false) {
  return protoOne(fields, number, 2, required) as Uint8Array | undefined;
}
export function protoText(fields: readonly ProtoField[], number: number, required = false) {
  const value = protoBytes(fields, number, required);
  return value === undefined ? undefined : new TextDecoder('utf-8', { fatal: true }).decode(value);
}
export function protoInteger(fields: readonly ProtoField[], number: number, fallback = 0) {
  const value = protoOne(fields, number, 0);
  if (value === undefined) return fallback;
  if (typeof value !== 'bigint' || value > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Native protobuf integer cannot be represented exactly');
  return Number(value);
}
export function protoBoolean(fields: readonly ProtoField[], number: number) {
  const value = protoInteger(fields, number);
  if (value !== 0 && value !== 1) throw Error('Native protobuf boolean is invalid');
  return value === 1;
}
function encodeInteger(value: bigint) {
  if (value < 0n || value > 0xffffffffffffffffn) throw Error('Native protobuf output integer is invalid');
  const bytes: number[] = [];
  do { const byte = Number(value & 127n); value >>= 7n; bytes.push(byte | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}
export function protoMessage(fields: readonly { number: number; value: string | bigint | Uint8Array }[]) {
  return Buffer.concat(fields.map(row => {
    if (!Number.isSafeInteger(row.number) || row.number < 1 || row.number > 536_870_911) throw Error('Native protobuf output field number is invalid');
    if (typeof row.value === 'bigint') return Buffer.concat([encodeInteger(BigInt(row.number) << 3n), encodeInteger(row.value)]);
    const value = typeof row.value === 'string' ? Buffer.from(row.value, 'utf8') : Buffer.from(row.value);
    if (value.length > MAX_MESSAGE) throw Error('Native protobuf output field exceeds its budget');
    return Buffer.concat([encodeInteger((BigInt(row.number) << 3n) | 2n), encodeInteger(BigInt(value.length)), value]);
  }));
}
export function protoTimestamp(raw: Uint8Array | undefined) {
  if (!raw) return undefined;
  const fields = protoFields(raw), seconds = protoInteger(fields, 1), nanos = protoInteger(fields, 2);
  if (nanos > 999_999_999 || seconds * 1000 > 8_640_000_000_000_000) throw Error('Native timestamp is invalid');
  return new Date(seconds * 1000).toISOString().slice(0, -5) + '.' + String(nanos).padStart(9, '0') + 'Z';
}
