import { createHash } from 'node:crypto';
import { z } from 'zod';
import { openBoltSnapshot } from './boltSnapshot';

const keySchema = z.string().regex(/^buildkit\/[1-9][0-9]*\/(?:[a-z0-9]{20,40}(?:-view)?|sha256:[a-f0-9]{64})$/);
/** containerd overlay snapshotter storage/v1. Its storage ID is a native
 * unsigned varint, distinct from the namespaced lease sequence in the key. */
export function readBuildKitSnapshotMetadata(raw: Uint8Array) {
  const db = openBoltSnapshot(raw), found = db.readBucket(['v1', 'snapshots']);
  const records = [...found].map(([key, value]) => {
    keySchema.parse(key); if (!value.bucket) throw Error('Native BuildKit snapshot bucket is unsupported');
    const fields = db.readBucket(['v1', 'snapshots', key]);
    const bytes = (name: string) => { const row = fields.get(name); if (!row || row.bucket) throw Error('Native BuildKit snapshot identity is missing'); return row.value; };
    const id = varint(bytes('id')), kind = bytes('kind');
    if (id === '0' || kind.length !== 1 || ![1, 2, 3].includes(kind[0]!)) throw Error('Native BuildKit snapshot kind or storage ID is unsupported');
    const parentField = fields.get('parent');
    if (parentField?.bucket) throw Error('Native BuildKit snapshot parent layout is unsupported');
    const parent = parentField?.value.length ? keySchema.parse(new TextDecoder('utf-8', { fatal: true }).decode(parentField.value)) : undefined;
    const created = bytes('createdat');
    if (created.length !== 15 || created[0] !== 1) throw Error('Native BuildKit snapshot birth encoding is unsupported');
    return { key, snapshot: key.slice(key.indexOf('/', 9) + 1), storageId: id, kind: kind[0]!, created: created.toString('hex'), ...(parent ? { parent } : {}) };
  });
  if (new Set(records.map(row => row.storageId)).size !== records.length || records.some(row => row.parent && !found.has(row.parent))) throw Error('Native BuildKit physical snapshot graph is incomplete or aliases storage');
  return { version: 'containerd-overlayfs/v1' as const, complete: true as const, records: records.sort((a, b) => a.key.localeCompare(b.key)),
    revision: createHash('sha256').update(Buffer.from(raw)).digest('hex') };
}
function varint(bytes: Buffer): string {
  if (!bytes.length || bytes.length > 10) throw Error('Native BuildKit snapshot storage ID is invalid');
  let value = 0n;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    if (i === 9 && byte > 1) throw Error('Native BuildKit snapshot storage ID overflows uint64');
    value |= BigInt(byte & 127) << BigInt(i * 7);
    if (!(byte & 128)) { if (i !== bytes.length - 1 || i && byte === 0) throw Error('Native BuildKit snapshot storage ID is noncanonical'); return String(value); }
  }
  throw Error('Native BuildKit snapshot storage ID is truncated');
}
