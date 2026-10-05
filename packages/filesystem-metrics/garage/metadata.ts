import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { filesystemSourceEpoch } from '../source';
import { garageNativeId, garageNativeRecord } from './messagepack';
import { decodeGarageRow, garageObjectVersions, garageVersionBlocks, garageRowKey } from './rows';
import type { GarageRowFamily } from './rows';

const id = z.string().regex(/^[a-f0-9]{64}$/), ids = z.array(id).max(100_000).refine(rows => new Set(rows).size === rows.length);
export const GarageMetadataQuerySchema = z.strictObject({ bucketId: id, spaceIds: z.array(z.uuid()).min(1).max(100_000),
  retainedVersions: ids, retainedUploads: ids, retainedBlocks: ids,
}).refine(row => new Set(row.spaceIds).size === row.spaceIds.length);
export type GarageMetadataQuery = z.infer<typeof GarageMetadataQuerySchema>;
type Row = { table: string; key: Uint8Array; bytes: Uint8Array; value: Record<string, unknown> };
type Binding = { bucketId: string; key: string };
const sha = (raw: string | Uint8Array) => createHash('sha256').update(raw).digest('hex');
const binding = (row: Record<string, unknown>): Binding => {
  if (typeof row['key'] !== 'string') throw Error('garage-native-object-key'); return { bucketId: garageNativeId(row['bucket_id']), key: row['key'] };
};
const deleted = (row: Record<string, unknown>) => {
  if (typeof row['deleted'] !== 'boolean') throw Error('garage-native-deleted-state'); return row['deleted'];
};
function tableRows(db: Database, family: GarageRowFamily, signal: AbortSignal) {
  const result: Row[] = [];
  for (const suffix of ['table', 'insert_queue']) {
    const table = 'tree_' + family + '_COLON_' + suffix;
    if (!db.query("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(table)) throw Error('garage-native-table-missing');
    const query = db.query<{ k: Uint8Array; v: Uint8Array }, [Uint8Array]>(`SELECT k,v FROM ${table} WHERE k>? ORDER BY k LIMIT 201`);
    let after: Uint8Array = new Uint8Array();
    for (;;) {
      signal.throwIfAborted(); const page = query.all(after); if (!page.length) break;
      for (const row of page) {
        if (result.length >= 100_000 || row.k.length < 32 || Buffer.compare(row.k, after) <= 0) throw Error('garage-native-full-table-budget');
        const value = decodeGarageRow(family, row.v);
        if (Buffer.compare(garageRowKey(family, value), row.k)) throw Error('garage-native-key-body-conflict');
        result.push({ table, key: row.k, bytes: row.v, value }); after = row.k;
      }
    }
  } return result;
}
function selectedMetadata(query: GarageMetadataQuery, rows: Record<GarageRowFamily, Row[]>) {
  const spaces = new Set(query.spaceIds), versions = new Set(query.retainedVersions), uploads = new Set(query.retainedUploads), blocks = new Set(query.retainedBlocks);
  const own = (value: Binding) => value.bucketId === query.bucketId && spaces.has(/^spaces\/([a-f0-9-]{36})\//.exec(value.key)?.[1] ?? '');
  const selected: Array<{ family: GarageRowFamily; table: string; key: string; digest: string; id: string; deleted: boolean }> = [];
  const objects: Array<{ key: string; versions: ReturnType<typeof garageObjectVersions> }> = [], multipart: Array<{ key: string; id: string; deleted: boolean }> = [];
  const add = (family: GarageRowFamily, row: Row, nativeId: string, gone: boolean) => selected.push({ family, table: row.table,
    key: Buffer.from(row.key).toString('hex'), digest: sha(row.bytes), id: nativeId, deleted: gone });
  for (const row of rows.object) if (own(binding(row.value))) {
    const original = garageObjectVersions(row.value);
    objects.push({ key: binding(row.value).key, versions: original });
    for (const version of original) { versions.add(version.id); version.blocks.forEach(hash => blocks.add(hash)); }
    add('object', row, sha(row.key), original.every(value => ['deleted', 'aborted'].includes(value.state)));
  }
  for (const row of rows.multipart_upload) {
    if (!own(binding(row.value))) {
      if (uploads.has(garageNativeId(row.value['upload_id']))) throw Error('garage-native-retained-upload-replaced');
      continue;
    }
    const nativeId = garageNativeId(row.value['upload_id']); uploads.add(nativeId); add('multipart_upload', row, nativeId, deleted(row.value));
    multipart.push({ key: binding(row.value).key, id: nativeId, deleted: deleted(row.value) });
  }
  for (const row of rows.version) {
    const nativeId = garageNativeId(row.value['uuid']), back = garageNativeRecord(row.value['backlink']);
    const object = back['Object'], upload = back['MultipartUpload'];
    if (versions.has(nativeId) && object && !own(binding(garageNativeRecord(object)))) throw Error('garage-native-retained-version-replaced');
    if (versions.has(nativeId) && upload && !uploads.has(garageNativeId(garageNativeRecord(upload)['upload_id']))) throw Error('garage-native-retained-version-replaced');
    if (!versions.has(nativeId) && !(object && own(binding(garageNativeRecord(object))))
      && !(upload && uploads.has(garageNativeId(garageNativeRecord(upload)['upload_id'])))) continue;
    versions.add(nativeId); garageVersionBlocks(row.value['blocks']).forEach(hash => blocks.add(hash)); add('version', row, nativeId, deleted(row.value));
  }
  const references: Array<{ block: string; version: string; deleted: boolean; owned: boolean }> = [];
  for (const row of rows.block_ref) if (versions.has(garageNativeId(row.value['version']))) blocks.add(garageNativeId(row.value['block']));
  for (const row of rows.block_ref) {
    const block = garageNativeId(row.value['block']), version = garageNativeId(row.value['version']);
    if (versions.has(version)) { blocks.add(block); add('block_ref', row, sha(row.key), deleted(row.value)); }
    if (blocks.has(block)) references.push({ block, version, deleted: deleted(row.value), owned: versions.has(version) });
  }
  // An orphan reference may be the only surviving original link; the scan above
  // is over every native row and pending insert, never a current-parent join.
  return { rows: selected, objects, multipart, versions: [...versions].sort(), uploads: [...uploads].sort(), blocks: [...blocks].sort(), references };
}

/** Detached native SQLite observation; it neither deletes bytes nor certifies
 * producer closure, consumer exit or physical reclamation. */
export async function observeGarageMetadata(root: string, directory: string, raw: GarageMetadataQuery, signal: AbortSignal) {
  const query = GarageMetadataQuerySchema.parse(raw);
  if (!isAbsolute(root) || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,252}$/.test(directory)) throw Error('garage-native-root');
  const volume = join(root, directory), file = join(volume, 'db.sqlite'), names = [root, volume, file];
  const pin = async () => Promise.all(names.map(async (name, i) => {
    const stat = await lstat(name, { bigint: true }); if (stat.isSymbolicLink()) throw Error('garage-native-source-symlink');
    return filesystemSourceEpoch(stat, i === 2 ? 'file' : 'directory');
  }));
  const original = await pin(), db = new Database(file, { readonly: true, create: false });
  try {
    db.exec('PRAGMA query_only=ON'); db.exec('BEGIN');
    const rows = Object.fromEntries((['object', 'multipart_upload', 'version', 'block_ref'] as const).map(family => [family, tableRows(db, family, signal)])) as Record<GarageRowFamily, Row[]>;
    const facts = selectedMetadata(query, rows); db.exec('ROLLBACK'); signal.throwIfAborted();
    if (JSON.stringify(await pin()) !== JSON.stringify(original)) throw Error('garage-native-source-replaced');
    return { version: 'garage-sqlite/2.4.1/v1' as const, observedAt: new Date().toISOString(), readonly: true as const,
      source: { rootIdentity: original[0]!, volumeIdentity: original[1]!, databaseIdentity: original[2]! }, queryIdentity: sha(JSON.stringify(query)),
      ...facts, revision: sha(JSON.stringify(facts)), physicalReclamationProven: false as const, producersClosed: false as const, consumersStopped: false as const };
  } finally { db.close(); }
}
