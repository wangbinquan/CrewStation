import { expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectIdSchema, ProjectDeletionContextSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { garageMetadataFixture, pack } from '../../../packages/filesystem-metrics/garage/fixture';
import { garageRowKey } from '../../../packages/filesystem-metrics/garage/rows';
import type { GarageRowFamily } from '../../../packages/filesystem-metrics/garage/rows';
import { observeGarageInventory } from '../../../packages/filesystem-metrics/garage/inventory';
import { garageObjectDeletionPhysics } from '../adapters/garage/deletionPhysics';
import { retainedGarageHistory } from '../adapters/garage/retained';
import type { DataDeletionScope } from '../ports/deletion/projectDeletion';

/** Actual native SQLite + every disk copy. Vendor effects and the external
 * node consumer are controlled; these tests do not claim production cleanup. */
async function fixture(inline = false, shared = false) {
  const f = await garageMetadataFixture(), projectId = ProjectIdSchema.parse(Bun.randomUUIDv7()), backendId = Bun.randomUUIDv7();
  const dataDirectory = 'blocks', data = join(f.root, dataDirectory), key = `spaces/${f.space}/attempts/${Bun.randomUUIDv7()}`;
  await mkdir(join(data, 'old'), { recursive: true });
  const files = [join(data, f.block.toString('hex')), join(data, 'old', f.block.toString('hex') + '.zst.corrupted')];
  if (!inline) for (const file of files) await writeFile(file, 'original-payload');
  const object = { bucket_id: f.bucket, key, versions: [{ uuid: f.original, timestamp: 1, state: { Complete: inline ? { Inline: [{ size: 7 }, Buffer.from('private')] } : { FirstBlock: [{ size: 16 }, f.block] } } }] };
  f.insert('object', object);
  const nativeVersion = { uuid: f.original, deleted: false, backlink: { Object: { bucket_id: f.bucket, key } }, blocks: [[{ part_number: 1, offset: 0 }, { hash: f.block, size: 16 }]] };
  const nativeRef = { block: f.block, version: f.original, deleted: false };
  if (!inline) { f.insert('version', nativeVersion); f.insert('block_ref', nativeRef); }
  if (shared) f.insert('block_ref', { block: f.block, version: f.foreign, deleted: false });
  const marker = { object: 'G2s3ob', version: 'G09s3v', multipart_upload: 'G09s3mpu', block_ref: '' };
  const update = (family: GarageRowFamily, value: Record<string, unknown>) => f.db.query(`UPDATE tree_${family}_COLON_table SET v=? WHERE k=?`).run(Buffer.concat([Buffer.from(marker[family]), pack(value)]), garageRowKey(family, value));
  const origin = { nodeUid: crypto.randomUUID(), nodeName: 'controlled-node', pvc: crypto.randomUUID() }, identity = jsonHash(origin);
  const observe = async (query: Parameters<typeof observeGarageInventory>[1]['query']) => ({ identity, origin, inventory: await observeGarageInventory(f.root, { key: 'owner', rootId: 'local', metadataDirectory: f.directory, dataDirectory, query }, AbortSignal.timeout(10_000)) });
  const consumer = { probeUid: crypto.randomUUID(), containerId: 'containerd://' + '3'.repeat(64), imageId: 'probe@sha256:' + '4'.repeat(64), nodeUid: origin.nodeUid, nodeName: origin.nodeName, bootId: crypto.randomUUID(), namespace: 'pid:[1]', identity: '5'.repeat(64) };
  const state = { closed: true, consumers: 0, permit: true, endpoint: 'http://garage:3900', shared, calls: [] as string[] };
  const target = { id: projectId, slug: 'garage-owner', name: 'Garage owner', namespace: 'cs-garage-owner', kind: 'DigitalWorker' as const, state: 'active' as const, revision: '1', prodHost: 'owner.invalid', previewHost: 'preview.owner.invalid', serviceHost: 'owner.service.invalid' };
  const scope: DataDeletionScope = { contents: [], origins: [{ kind: 'space', key: f.space, id: f.space, projectId }], locations: [{ backendId, placementRevision: 1, key, size: 16 }], placements: [{ spaceId: f.space, backendId, placementRevision: 1 }],
    backendReleases: [], objectsPresent: true, compacted: false, count: 1, digest: jsonHash({ projectId, key }) };
  const physics = garageObjectDeletionPhysics({ s3Endpoint: 'http://garage:3900', source: { capture: observe, verify: async (query, original) => {
    const actual = await observe(query); if (actual.identity !== original.identity) throw Error('original source changed'); return actual;
  } }, consumers: { capture: async () => ({ source: consumer, complete: true, count: state.consumers, digest: jsonHash(state.consumers) }), observe: async () => ({ source: consumer, complete: true, count: state.consumers, digest: jsonHash(state.consumers) }) },
    objects: { location: async () => ({ endpoint: state.endpoint, bucket: 'original', region: 'garage' }), remove: async (_location, _signal, authorize) => {
      await authorize(); state.calls.push('remove');
      update('object', { ...object, versions: [{ uuid: Buffer.alloc(32, 8), timestamp: 2, state: { Complete: 'DeleteMarker' } }] });
      if (!inline) { update('version', { ...nativeVersion, deleted: true }); update('block_ref', { ...nativeRef, deleted: true }); }
      await authorize();
    }, abort: async () => { state.calls.push('abort'); } },
    garage: { cluster: async () => ({ node: '2'.repeat(64), revision: '1'.repeat(64) }), bucket: async () => ({ id: f.bucket.toString('hex'), created: '2026-09-28T00:00:00.000Z' }), purgeExclusive: async (_input, _signal, authorize) => {
      await authorize(); state.calls.push('purge'); return state.shared ? { kind: 'shared' } : { kind: 'acknowledged', digest: '6'.repeat(64), physicalReclamationProven: false };
    } }, authorize: async () => { if (!state.permit) throw Error('original grant revoked'); }, closed: async () => state.closed ? jsonHash('actual fixture closure') : undefined,
    exclusive: async (_context, work) => work() });
  const captured = await physics.inspect(target, scope), retained = { ...scope, nativeHistory: captured.nativeHistory };
  const context = (phase: 'stop' | 'purge' | 'prove' | 'verify') => ProjectDeletionContextSchema.parse({ target, operationId: Bun.randomUUIDv7(), generation: 1, phase,
    confirmed: { participant: 'data', complete: true, resources: [], references: [], blockers: [], revision: jsonHash(retained) } });
  return { ...f, files, object, nativeVersion, nativeRef, update, physics, state, target, scope, retained, captured, context, observe };
}

test('stop and native acknowledgements cannot certify byte recovery; every old copy must actually disappear', async () => {
  const f = await fixture();
  try {
    const history = retainedGarageHistory(f.retained)!; expect(history.groups[0]!.files).toHaveLength(2);
    f.state.closed = false; expect((await f.physics.run(f.context('stop'), f.retained, f.captured.identity)).kind).toBe('waiting'); expect(f.state.calls).toEqual([]);
    f.state.closed = true; f.state.consumers = 1;
    expect((await f.physics.run(f.context('purge'), f.retained, f.captured.identity)).kind).toBe('waiting'); expect(f.state.calls).toEqual([]);
    f.state.consumers = 0;
    expect(await f.physics.run(f.context('stop'), f.retained, f.captured.identity)).toMatchObject({ kind: 'done', producersClosed: true, consumersStopped: true });
    expect((await f.physics.run(f.context('purge'), f.retained, f.captured.identity)).kind).toBe('waiting'); expect(f.state.calls).toEqual(['remove', 'purge']);
    await rm(f.files[0]!);
    expect((await f.physics.run(f.context('prove'), f.retained, f.captured.identity)).kind).toBe('waiting');
    expect(await readFile(f.files[1]!, 'utf8')).toBe('original-payload'); await rm(f.files[1]!);
    const reloaded: DataDeletionScope = JSON.parse(JSON.stringify({ ...f.retained, contents: [], origins: [], locations: [], placements: [], compacted: true }));
    expect(await f.physics.run(f.context('verify'), reloaded, f.captured.identity)).toMatchObject({ kind: 'done', remaining: 0, independent: true, sourceIdentity: f.captured.identity });
    expect(retainedGarageHistory(reloaded)?.groups[0]?.files).toHaveLength(2);
  } finally { await f.dispose(); }
});
test('foreign shared blocks remain byte-for-byte intact after owned references are removed', async () => {
  const f = await fixture(false, true);
  try {
    const before = await Promise.all(f.files.map(file => readFile(file)));
    expect(await f.physics.run(f.context('purge'), f.retained, f.captured.identity)).toMatchObject({ kind: 'done', remaining: 0 });
    expect(await Promise.all(f.files.map(file => readFile(file)))).toEqual(before);
    const result = await f.observe(retainedGarageHistory(f.retained)!.groups[0]!.query);
    expect(result.inventory.metadata.references.find(row => !row.owned)).toMatchObject({ deleted: false });
  } finally { await f.dispose(); }
});
test('inline deletion may create a payload-free vendor tombstone; old history survives metadata removal and a new adapter inspection', async () => {
  const f = await fixture(true);
  try {
    expect(await f.physics.run(f.context('purge'), f.retained, f.captured.identity)).toMatchObject({ kind: 'done', remaining: 0 });
    const current = { ...f.retained, contents: [], origins: [], locations: [], placements: [], compacted: true };
    const result = await f.physics.inspect(f.target, current);
    expect(result.identity).toBe(f.captured.identity);
    expect(retainedGarageHistory({ ...current, nativeHistory: result.nativeHistory })?.groups[0]?.query.spaceIds).toEqual([f.space]);
    expect(JSON.stringify(result.nativeHistory)).not.toContain('private');
  } finally { await f.dispose(); }
});
test('new live versions, inode substitution, foreign endpoints and revoked grants issue no cleanup effect', async () => {
  const f = await fixture();
  try {
    const newVersion = { ...f.object.versions[0]!, uuid: Buffer.alloc(32, 7) };
    f.update('object', { ...f.object, versions: [newVersion] });
    await expect(f.physics.run(f.context('purge'), f.retained, f.captured.identity)).rejects.toThrow('新的版本'); expect(f.state.calls).toEqual([]);
    f.update('object', f.object);
    const replacement = f.files[0]! + '.replacement'; await writeFile(replacement, 'different-birth'); await rm(f.files[0]!);
    await writeFile(f.files[0]!, await readFile(replacement)); await rm(replacement);
    await expect(f.physics.run(f.context('purge'), f.retained, f.captured.identity)).rejects.toThrow('出生'); expect(f.state.calls).toEqual([]);
    f.state.endpoint = 'http://foreign:3900'; await expect(f.physics.inspect(f.target, f.scope)).rejects.toThrow('独立物理来源');
    f.state.permit = false; await expect(f.physics.run(f.context('purge'), f.retained, f.captured.identity)).rejects.toThrow('revoked'); expect(f.state.calls).toEqual([]);
  } finally { await f.dispose(); }
});
