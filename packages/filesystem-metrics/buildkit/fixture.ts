import { boltChecksum } from './boltSnapshot';

type Field = { key: string; value: Buffer; bucket: boolean };
export type BoltFixtureField = { key: string; value: Buffer | readonly BoltFixtureField[] };
export function boltSnapshotFixture(fields: readonly BoltFixtureField[]): Buffer {
  const encode = (items: readonly BoltFixtureField[]): Buffer => leaf(items.map(row => ({ key: row.key, bucket: Array.isArray(row.value),
    value: Array.isArray(row.value) ? Buffer.concat([Buffer.alloc(16), encode(row.value)]) : row.value as Buffer })));
  const body = encode(fields), count = 2 + Math.ceil(body.length / 4096), raw = Buffer.alloc(Math.max(4, count) * 4096);
  for (let page = 0; page < 2; page++) {
    const offset = page * 4096; raw.writeBigUInt64LE(BigInt(page), offset); raw.writeUInt16LE(4, offset + 8);
    raw.writeUInt32LE(0xed0cdaed, offset + 16); raw.writeUInt32LE(2, offset + 20); raw.writeUInt32LE(4096, offset + 24);
    raw.writeBigUInt64LE(2n, offset + 32); raw.writeBigUInt64LE(0xffffffffffffffffn, offset + 48); raw.writeBigUInt64LE(BigInt(count), offset + 56);
    raw.writeBigUInt64LE(BigInt(page + 1), offset + 64); raw.writeBigUInt64LE(boltChecksum(raw.subarray(offset + 16, offset + 72)), offset + 72);
  }
  body.writeBigUInt64LE(2n); body.writeUInt32LE(Math.ceil(body.length / 4096) - 1, 12); body.copy(raw, 8192); return raw;
}
/** Native binary bbolt pages, not a mocked decoded cache response. */
export function boltCacheFixture(records: readonly { id: string; fields: Record<string, string | null> }[], branch = false): Buffer {
  const inline = (fields: Field[]) => Buffer.concat([Buffer.alloc(16), leaf(fields)]);
  const main: Field = { key: '_main', bucket: true, value: inline(records.map(row => ({ key: row.id, bucket: true,
    value: inline(Object.entries(row.fields).map(([key, value]) => ({ key, bucket: false, value: Buffer.from(value ?? '') }))) }))) };
  const top = leaf([main]), pageCount = branch ? 6 + Math.ceil(top.length / 4096) : 2 + Math.ceil(top.length / 4096);
  const data = Buffer.alloc(Math.max(4, pageCount) * 4096), root = 2;
  for (const [page, txid] of [[0, 1], [1, 2]]) {
    const offset = page! * 4096; data.writeBigUInt64LE(BigInt(page!), offset); data.writeUInt16LE(4, offset + 8);
    data.writeUInt32LE(0xed0cdaed, offset + 16); data.writeUInt32LE(2, offset + 20); data.writeUInt32LE(4096, offset + 24);
    data.writeBigUInt64LE(BigInt(root), offset + 32); data.writeBigUInt64LE(0xffffffffffffffffn, offset + 48);
    data.writeBigUInt64LE(BigInt(pageCount), offset + 56); data.writeBigUInt64LE(BigInt(txid!), offset + 64);
    data.writeBigUInt64LE(boltChecksum(data.subarray(offset + 16, offset + 72)), offset + 72);
  }
  const write = (id: number, body: Buffer) => {
    body.writeBigUInt64LE(BigInt(id)); body.writeUInt32LE(Math.ceil(body.length / 4096) - 1, 12); body.copy(data, id * 4096);
  };
  if (branch) {
    const keys = ['_index', '_main'], bytes = Buffer.alloc(48 + keys.join('').length);
    bytes.writeUInt16LE(1, 8); bytes.writeUInt16LE(2, 10); let cursor = 48;
    for (let i = 0; i < keys.length; i++) {
      const start = 16 + i * 16, key = Buffer.from(keys[i]!); bytes.writeUInt32LE(cursor - start, start);
      bytes.writeUInt32LE(key.length, start + 4); bytes.writeBigUInt64LE(BigInt(3 + i), start + 8); key.copy(bytes, cursor); cursor += key.length;
    }
    write(2, bytes); write(3, leaf([{ key: '_index', bucket: true, value: inline([]) }])); write(4, top);
  } else write(2, top);
  return data;
}
function leaf(raw: Field[]): Buffer {
  const fields = [...raw].sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  const bytes = Buffer.alloc(16 + fields.length * 16 + fields.reduce((sum, field) => sum + Buffer.byteLength(field.key) + field.value.length, 0));
  bytes.writeUInt16LE(2, 8); bytes.writeUInt16LE(fields.length, 10); let cursor = 16 + fields.length * 16;
  for (const [i, field] of fields.entries()) {
    const element = 16 + i * 16, key = Buffer.from(field.key); bytes.writeUInt32LE(field.bucket ? 1 : 0, element);
    bytes.writeUInt32LE(cursor - element, element + 4); bytes.writeUInt32LE(key.length, element + 8); bytes.writeUInt32LE(field.value.length, element + 12);
    key.copy(bytes, cursor); cursor += key.length; field.value.copy(bytes, cursor); cursor += field.value.length;
  }
  return bytes;
}
