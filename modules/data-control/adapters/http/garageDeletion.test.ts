import { expect, test } from 'bun:test';
import { garageDeletionTransport } from './garageDeletion';

const node = 'aa'.repeat(32), hash = 'bb'.repeat(32), version = 'cc'.repeat(32), bucketId = 'dd'.repeat(32), space = '01a0fa00-0000-7000-8000-000000000001';
const input = { node, hash, bucketId, spaceIds: [space], versions: [version], uploads: [] as string[] };
function fixture(mode = 'owned') {
  const calls: string[] = [], bodies: unknown[] = [];
  const transport = garageDeletionTransport({ endpoint: 'https://original.invalid', token: 'native-admin-token-12345678901234567890' }, async (url, init) => {
    const operation = url.pathname.slice(4); calls.push(operation); if (init.body) bodies.push(JSON.parse(String(init.body)));
    if (operation === 'GetClusterHealth') return Response.json({ status: 'healthy', knownNodes: 1, connectedNodes: 1, storageNodes: 1, storageNodesUp: 1, partitions: 256, partitionsAllOk: 256 });
    if (operation === 'GetClusterStatus') return Response.json({ nodes: [{ id: mode === 'new node' ? 'ee'.repeat(32) : node, garageVersion: mode === 'installed version' ? 'v2.4.1' : mode === 'unsupported version' ? 'v2.5.0' : '2.4.1', isUp: true, draining: false, role: { capacity: 100 } }] });
    if (operation === 'GetBucketInfo') return Response.json({ id: bucketId, created: '2026-01-01T00:00:00Z', globalAliases: ['original'] });
    if (operation === 'GetBlockInfo') {
      const row = { versionId: mode === 'foreign version' ? 'ff'.repeat(32) : version, refDeleted: false, versionDeleted: false, garbageCollected: false,
        backlink: { object: { bucketId, key: mode === 'foreign space' ? 'spaces/01a0fa00-0000-7000-8000-000000000002/attempts/original' : `spaces/${space}/attempts/original` } } };
      return Response.json({ success: { [node]: { blockHash: hash, refcount: mode === 'pending ref' ? 2 : 1, versions: mode === 'truncated' ? Array(10000).fill(row) : [row] } }, error: mode === 'missing node' ? { [node]: 'unavailable' } : {} });
    }
    if (operation === 'PurgeBlocks') return Response.json({ success: { [node]: { blocksPurged: 1, objectsDeleted: 1, uploadsDeleted: 0, versionsDeleted: 1, blockRefsPurged: 1 } }, error: {} });
    return new Response(null, { status: 404 });
  }); return { transport, calls, bodies };
}
test('vendor-native exclusive reference purge checks original node and all back-links, yet never treats its acknowledgement as reclaimed bytes', async () => {
  const f = fixture(); let grants = 0;
  expect(await f.transport.bucket('original', AbortSignal.timeout(5000))).toEqual({ id: bucketId, created: '2026-01-01T00:00:00Z' });
  const result = await f.transport.purgeExclusive(input, AbortSignal.timeout(5000), async () => { grants++; });
  expect(result).toMatchObject({ kind: 'acknowledged', physicalReclamationProven: false }); expect(grants).toBe(2);
  expect(f.calls).toEqual(['GetBucketInfo', 'GetClusterHealth', 'GetClusterStatus', 'GetBlockInfo', 'PurgeBlocks']);
  expect(f.bodies).toEqual([{ blockHash: hash }, [hash]]);
});
test('shared block, changed node, full native page and unavailable-node response cannot trigger native mutation', async () => {
  for (const mode of ['foreign version', 'foreign space', 'new node', 'truncated', 'missing node', 'unsupported version']) {
    const f = fixture(mode);
    if (mode.startsWith('foreign')) expect(await f.transport.purgeExclusive(input, AbortSignal.timeout(5000), async () => undefined)).toEqual({ kind: 'shared' });
    else await expect(f.transport.purgeExclusive(input, AbortSignal.timeout(5000), async () => undefined)).rejects.toThrow();
    expect(f.calls).not.toContain('PurgeBlocks');
  }
});
test('installed Garage 2.4.1 reports its HTTP version with a v prefix, matching the verified original image and native schema', async () => {
  // Real-node receipt: garage-version-http-readonly-v1.json. CLI omits `v`,
  // whereas GetClusterStatus returns it; the strict source must accept both.
  expect((await fixture('installed version').transport.cluster(AbortSignal.timeout(5000))).node).toBe(node);
});
test('a reference count ahead of the complete version table prevents purging a block with a pending foreign reference', async () => {
  const f = fixture('pending ref');
  expect(await f.transport.purgeExclusive(input, AbortSignal.timeout(5000), async () => undefined)).toEqual({ kind: 'shared' });
  expect(f.calls).not.toContain('PurgeBlocks');
});
test('revocation prevents the actual vendor call after fresh native inspection; invalid bucket alias cannot select another original bucket', async () => {
  const f = fixture();
  await expect(f.transport.purgeExclusive(input, AbortSignal.timeout(5000), async () => { throw Error('revoked'); })).rejects.toThrow('revoked');
  expect(f.calls).not.toContain('PurgeBlocks');
  await expect(f.transport.bucket('foreign', AbortSignal.timeout(5000))).rejects.toThrow('归属变化');
});
test('caller mutation while authorization awaits cannot redirect the verified native effect to another block', async () => {
  const f = fixture(), value = structuredClone(input);
  await f.transport.purgeExclusive(value, AbortSignal.timeout(5000), async () => { value.hash = 'ee'.repeat(32); value.versions.length = 0; });
  expect(f.bodies).toEqual([{ blockHash: hash }, [hash]]);
});
