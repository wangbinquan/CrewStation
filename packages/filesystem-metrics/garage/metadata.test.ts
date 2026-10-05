import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { observeGarageMetadata } from './metadata';
import { garageMetadataFixture } from './fixture';
import { decodeGarageMessagePack } from './messagepack';
import { garageObjectVersions } from './rows';

test('native SQL traverses all 201 old keys, pending writes and uploads while returning no inline payload or physical completion', async () => {
  const f = await garageMetadataFixture();
  try {
    const uuid = f.original;
    for (let i = 0; i < 201; i++) f.insert('object', { bucket_id: f.bucket, key: `spaces/${f.space}/attempts/${i}`, versions: [
      { uuid, timestamp: 1, state: { Complete: { Inline: [{ size: 7 }, Buffer.from('private')] } } },
    ] });
    f.insert('object', { bucket_id: f.bucket, key: `spaces/${f.space}/attempts/pending`, versions: [{ uuid: f.foreign, timestamp: 2, state: { Uploading: {} } }] }, true);
    f.insert('multipart_upload', { bucket_id: f.bucket, key: `spaces/${f.space}/attempts/upload`, upload_id: f.original, deleted: false, parts: [] });
    f.insert('object', { bucket_id: f.bucket, key: `spaces/${f.sibling}/attempts/foreign`, versions: [] });
    const before = await readFile(f.file), names = await readdir(join(f.root, f.directory));
    const result = await observeGarageMetadata(f.root, f.directory, f.query, AbortSignal.timeout(10_000));
    expect(result.rows).toHaveLength(203); expect(result.rows.filter(row => row.deleted)).toHaveLength(0);
    expect(result.objects).toHaveLength(202); expect(result.multipart).toEqual([{ key: `spaces/${f.space}/attempts/upload`, id: f.original.toString('hex'), deleted: false }]);
    expect(JSON.stringify(result)).not.toContain('private'); expect(result.physicalReclamationProven).toBe(false);
    expect(await readdir(join(f.root, f.directory))).toEqual(names);
    expect(createHash('sha256').update(await readFile(f.file)).digest('hex')).toBe(createHash('sha256').update(before).digest('hex'));
  } finally { await f.dispose(); }
});
test('SSE-C inline native size describes plaintext; GCM tag and confidential metadata are neither miscounted nor exported', async () => {
  const f = await garageMetadataFixture();
  try {
    const value = { bucket_id: f.bucket, key: `spaces/${f.space}/attempts/encrypted`, versions: [{ uuid: f.original, timestamp: 1,
      state: { Complete: { Inline: [{ size: 7, encryption: { SseC: { inner: Buffer.from('confidential-headers'), compressed: false, use_oek: true } } }, Buffer.alloc(23, 9)] } } }] };
    f.insert('object', value);
    const result = await observeGarageMetadata(f.root, f.directory, f.query, AbortSignal.timeout(5000));
    expect(result.objects[0]?.versions[0]).toMatchObject({ bytes: 7, state: 'inline' }); expect(JSON.stringify(result)).not.toContain('confidential');
    expect(() => garageObjectVersions({ versions: [{ ...value.versions[0], state: { Complete: { Inline: [{ size: 7, encryption: { SseC: {} } }, Buffer.alloc(7)] } } }] })).toThrow('inline-bytes');
  } finally { await f.dispose(); }
});
test('detached versions survive absent object parents; earlier foreign references to an original shared block are retained', async () => {
  const f = await garageMetadataFixture();
  try {
    f.insert('version', { uuid: f.original, deleted: false, backlink: { Object: { bucket_id: f.bucket, key: `spaces/${f.space}/attempts/orphan` } }, blocks: [[{ part_number: 1, offset: 0 }, { hash: f.block, size: 17 }]] });
    f.insert('block_ref', { block: f.block, version: f.foreign, deleted: false });
    f.insert('block_ref', { block: f.block, version: f.original, deleted: false }, true);
    const result = await observeGarageMetadata(f.root, f.directory, f.query, AbortSignal.timeout(10_000));
    expect(result.versions).toEqual([f.original.toString('hex')]); expect(result.blocks).toEqual([f.block.toString('hex')]);
    expect(result.references).toHaveLength(2); expect(result.references[0]).toMatchObject({ owned: false, deleted: false });
    expect(result.rows.map(row => row.family)).toEqual(['version', 'block_ref']);
  } finally { await f.dispose(); }
});
test('source symlinks, corrupted original keys, unsupported/truncated codecs and uint64 rounding cannot certify native emptiness', async () => {
  const f = await garageMetadataFixture();
  try {
    await symlink(join(f.root, f.directory), join(f.root, 'replacement'));
    await expect(observeGarageMetadata(f.root, 'replacement', f.query, AbortSignal.timeout(1000))).rejects.toThrow('symlink');
    f.insert('object', { bucket_id: f.bucket, key: `spaces/${f.space}/attempts/corrupt`, versions: [] }, false, Buffer.alloc(32, 12));
    await expect(observeGarageMetadata(f.root, f.directory, f.query, AbortSignal.timeout(1000))).rejects.toThrow('key-body-conflict');
    expect(decodeGarageMessagePack(Buffer.from('cfffffffffffffffff', 'hex'))).toBe(18_446_744_073_709_551_615n);
    for (const raw of [Buffer.from('df0000000161c0', 'hex'), Buffer.from([0x81, 0xa1, 0x61]), Buffer.from([0xc1]), Buffer.from([0xc0, 0xc0]), Buffer.from([0xa1, 0xff])])
      expect(() => decodeGarageMessagePack(raw)).toThrow();
  } finally { await f.dispose(); }
});
