import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { observeRegistryInventory } from './inventory';
import { bindRegistryHistory, captureRegistryHistory, registryExclusiveConsumerFiles, registryHistoryIdentity, retainedRegistryQuery } from './retained';
import type { RegistryDeletionHistory } from './retained';
import type { RegistryInventoryRequest } from './protocol';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cs-registry-history-')), base = join(root, 'volume/docker/registry/v2');
  const file = async (path: string, content: string) => { const full = join(base, path); await mkdir(dirname(full), { recursive: true }); await writeFile(full, content); };
  const blob = async (bytes: string) => { const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex'); await file(`blobs/sha256/${digest.slice(7, 9)}/${digest.slice(7)}/data`, bytes); return digest; };
  const own = await blob('old project payload'), config = await blob('{}'), manifest = await blob(JSON.stringify({ schemaVersion: 2, config: { digest: config }, layers: [{ digest: own }] }));
  await file(`repositories/apps/original/_manifests/revisions/sha256/${manifest.slice(7)}/link`, manifest);
  const query: RegistryInventoryRequest = { key: 'original', rootId: 'local', directory: 'volume', exact: ['apps/original'], prefixes: ['runtime/projects/original'], retainedDigests: [], retainedManifests: [] };
  const origin = { podUid: randomUUID(), pvcUid: randomUUID(), pvUid: randomUUID(), containerId: 'containerd://' + 'a'.repeat(64) }, identity = hash(origin);
  const history = captureRegistryHistory({ version: 1, projectId: randomUUID(), sourceIdentity: identity, origin, query, original: await observeRegistryInventory(root, query),
    consumers: { identity: hash('probe'), probeUid: randomUUID(), containerId: 'containerd://' + 'b'.repeat(64), imageId: 'probe@sha256:' + 'c'.repeat(64), nodeUid: randomUUID(), nodeName: 'original-node', bootId: randomUUID(), namespace: 'pid:[1]' } });
  const current = async (raw: RegistryDeletionHistory = history) => ({ identity, origin, inventory: await observeRegistryInventory(root, { ...query, ...retainedRegistryQuery(raw) }) });
  return { root, base, query, own, config, manifest, history, current, file, blob, drop: () => rm(root, { recursive: true, force: true }) };
}
test('retained native graph survives catalog unlink and a JSON round trip; old exclusive bytes and open descriptor identities remain visible', async () => {
  const f = await fixture(); try {
    const restored = captureRegistryHistory(JSON.parse(JSON.stringify(f.history)));
    await rm(join(f.base, 'repositories/apps/original'), { recursive: true });
    const current = await f.current(restored), counts = bindRegistryHistory(restored, current);
    expect(counts.native).toBe(0); expect(counts.storage).toBe(3); expect(counts.allocatedBytes).toBeGreaterThan(0);
    expect(current.inventory.blobs.map(row => row.digest)).toContain(f.own);
    await rm(join(f.base, `blobs/sha256/${f.own.slice(7, 9)}/${f.own.slice(7)}/data`));
    const missing = await f.current(); expect(bindRegistryHistory(restored, missing).storage).toBe(2);
    const old = restored.original.blobs.find(row => row.digest === f.own)!;
    expect(registryExclusiveConsumerFiles(restored, missing.inventory)).toContainEqual({ device: old.device, inode: old.inode });
  } finally { await f.drop(); }
});
test('an independently observed new foreign reference preserves the original shared bytes and excludes their foreign consumers', async () => {
  const f = await fixture(); try {
    const other = await f.blob(JSON.stringify({ schemaVersion: 2, config: { digest: f.config }, layers: [{ digest: f.own }], annotations: { owner: 'other' } }));
    await f.file(`repositories/apps/other/_manifests/revisions/sha256/${other.slice(7)}/link`, other);
    const current = await f.current(), old = f.history.original.blobs.find(row => row.digest === f.own)!;
    expect(bindRegistryHistory(f.history, current).storage).toBe(1);
    expect(registryExclusiveConsumerFiles(f.history, current.inventory)).not.toContainEqual({ device: old.device, inode: old.inode });
  } finally { await f.drop(); }
});
test('a fresh but empty scope, source substitution and a copied same-name inode cannot prove original reclamation', async () => {
  const f = await fixture(); try {
    const current = await f.current();
    const empty = await observeRegistryInventory(f.root, { ...f.query, exact: ['apps/missing'], prefixes: [] });
    expect(() => bindRegistryHistory(f.history, { ...current, inventory: empty })).toThrow('omitted');
    expect(() => registryExclusiveConsumerFiles(f.history, empty)).toThrow('omitted');
    expect(() => bindRegistryHistory(f.history, { ...current, identity: hash('replacement') })).toThrow('changed');
    expect(() => bindRegistryHistory(f.history, { ...current, origin: { ...current.origin, pvcUid: randomUUID() } })).toThrow('changed');
    const path = join(f.base, `blobs/sha256/${f.own.slice(7, 9)}/${f.own.slice(7)}/data`);
    await rename(path, join(f.root, 'old-original-payload')); await writeFile(path, 'old project payload');
    expect(() => bindRegistryHistory(f.history, { ...current, inventory: { ...current.inventory, blobs: [] } })).toThrow('omitted');
    const changed = await f.current(); expect(() => bindRegistryHistory(f.history, changed)).toThrow('replaced');
  } finally { await f.drop(); }
});
test('transport observation time does not continuously invalidate confirmations, while a changed native identity or original payload does', async () => {
  const f = await fixture(); try {
    const refreshed = structuredClone(f.history); refreshed.original.observedAt = '2026-10-05T12:00:00.000Z'; refreshed.original.revision = hash('unrelated foreign tree revision');
    expect(registryHistoryIdentity(refreshed)).toBe(registryHistoryIdentity(f.history));
    refreshed.original.blobs[0]!.inode = '999999'; expect(registryHistoryIdentity(refreshed)).not.toBe(registryHistoryIdentity(f.history));
    refreshed.query.exact = ['apps/other']; expect(() => captureRegistryHistory(refreshed)).toThrow('request');
    expect(JSON.stringify(f.history)).not.toContain('old project payload');
  } finally { await f.drop(); }
});
test('local Registry origin reordering preserves published material hashes without losing fields or accepting a replaced physical origin', async () => {
  const f = await fixture(); try {
    const origin = { namespaceUid: randomUUID(), serviceUid: randomUUID(), podUid: randomUUID(), containerId: 'containerd://' + 'a'.repeat(64), imageId: 'registry@sha256:' + 'b'.repeat(64),
      nodeUid: randomUUID(), nodeName: 'original-node', pvcUid: randomUUID(), pvUid: randomUUID(), providerPath: '/original/volume', mountPath: '/var/lib/registry',
      rootEpoch: f.history.original.rootIdentity, volumeEpoch: f.history.original.volumeIdentity, probeUid: randomUUID() };
    const history = captureRegistryHistory({ ...f.history, origin, sourceIdentity: hash(origin) });
    const restored = { ...history, origin: Object.fromEntries(Object.entries(origin).reverse()) };
    // PostgreSQL JSONB reorders the opaque origin and previously changed the complete material identity.
    expect(registryHistoryIdentity(restored)).toBe(registryHistoryIdentity(history));
    const current = { identity: history.sourceIdentity, origin, inventory: await observeRegistryInventory(f.root, { ...f.query, ...retainedRegistryQuery(history) }) };
    expect(bindRegistryHistory(restored, current).storage).toBe(3);
    for (const field of Object.keys(origin)) {
      const changed = { ...history, origin: { ...origin, [field]: randomUUID() } };
      expect(registryHistoryIdentity(changed)).not.toBe(registryHistoryIdentity(history));
      expect(() => bindRegistryHistory(changed, current)).toThrow('changed');
    }
    expect(registryHistoryIdentity({ ...history, origin: { ...origin, unknownSourceField: true } })).not.toBe(registryHistoryIdentity(history));
    expect(captureRegistryHistory(restored).origin).toEqual(origin);
  } finally { await f.drop(); }
});
test('platform catalog pins remain in the original storage request after metadata disappears, rather than becoming project-owned by prefix', async () => {
  const f = await fixture(); try {
    const query = { ...f.query, protectedRepositories: ['apps/original'] }, original = await observeRegistryInventory(f.root, query);
    const history = captureRegistryHistory({ ...f.history, query, original });
    const retained = retainedRegistryQuery(history);
    expect(retained.protectedRepositories).toEqual(['apps/original']); expect(original.entries).toHaveLength(0);
    const current = { identity: history.sourceIdentity, origin: history.origin, inventory: await observeRegistryInventory(f.root, { ...query, ...retained }) };
    expect(bindRegistryHistory(history, current)).toMatchObject({ native: 0, storage: 0, allocatedBytes: 0 });
    const changed = structuredClone(history); changed.query.protectedRepositories = [];
    expect(() => captureRegistryHistory(changed)).toThrow('request');
  } finally { await f.drop(); }
});
