import { Database } from 'bun:sqlite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { garageRowKey } from './rows';
import type { GarageRowFamily } from './rows';

/** Test-only serialization of vendor-shaped records; no private data fixture. */
export function pack(value: unknown): Buffer {
  if (value === null) return Buffer.from([0xc0]);
  if (typeof value === 'boolean') return Buffer.from([value ? 0xc3 : 0xc2]);
  if (value instanceof Uint8Array) {
    const header = Buffer.alloc(5); header[0] = 0xc6; header.writeUInt32BE(value.length, 1); return Buffer.concat([header, value]);
  }
  if (typeof value === 'number') { const header = Buffer.alloc(9); header[0] = 0xcf; header.writeBigUInt64BE(BigInt(value), 1); return header; }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value), header = Buffer.alloc(5); header[0] = 0xdb; header.writeUInt32BE(bytes.length, 1); return Buffer.concat([header, bytes]);
  }
  const entries = Array.isArray(value) ? value.map(pack) : Object.entries(value as object).flatMap(([key, row]) => [pack(key), pack(row)]);
  const count = Array.isArray(value) ? entries.length : entries.length / 2, header = Buffer.alloc(5);
  header[0] = Array.isArray(value) ? 0xdd : 0xdf; header.writeUInt32BE(count, 1); return Buffer.concat([header, ...entries]);
}
export async function garageMetadataFixture() {
  const root = await mkdtemp(join(tmpdir(), 'cs-garage-native-')), directory = 'original', file = join(root, directory, 'db.sqlite');
  await mkdir(join(root, directory)); const db = new Database(file);
  const families = ['object', 'version', 'multipart_upload', 'block_ref'] as const;
  for (const family of families) for (const suffix of ['table', 'insert_queue']) db.exec(`CREATE TABLE tree_${family}_COLON_${suffix}(k BLOB PRIMARY KEY,v BLOB NOT NULL)`);
  const marker = { object: 'G2s3ob', version: 'G09s3v', multipart_upload: 'G09s3mpu', block_ref: '' };
  const insert = (family: GarageRowFamily, value: Record<string, unknown>, pending = false, key = garageRowKey(family, value)) => {
    db.query(`INSERT INTO tree_${family}_COLON_${pending ? 'insert_queue' : 'table'} VALUES(?,?)`).run(key, Buffer.concat([Buffer.from(marker[family]), pack(value)]));
  };
  const bucket = Buffer.alloc(32, 187), block = Buffer.alloc(32, 204), original = Buffer.alloc(32, 255), foreign = Buffer.alloc(32, 1);
  const space = '73fa6bd2-3c64-4d61-8ab3-fa4ff0cc372a', sibling = '73fa6bd2-3c64-4d61-8ab3-fa4ff0cc372b';
  const query = { bucketId: bucket.toString('hex'), spaceIds: [space], retainedVersions: [] as string[], retainedUploads: [] as string[], retainedBlocks: [] as string[] };
  return { root, directory, file, db, insert, bucket, block, original, foreign, space, sibling, query, dispose: async () => { db.close(); await rm(root, { recursive: true, force: true }); } };
}
