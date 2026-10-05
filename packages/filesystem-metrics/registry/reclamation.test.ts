import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { observeRegistryInventory } from './inventory';
import { reclaimRegistryInventory } from './reclamation';
import type { RegistryReclamationAuthority } from './reclamation';
import type { RegistryInventoryRequest } from './protocol';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cs-registry-reclaim-')), base = join(root, 'volume/docker/registry/v2');
  const file = async (path: string, value: string) => { const target = join(base, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, value); return target; };
  const blob = async (value: string) => { const digest = 'sha256:' + createHash('sha256').update(value).digest('hex'); await file(`blobs/sha256/${digest.slice(7, 9)}/${digest.slice(7)}/data`, value); return digest; };
  const link = (repo: string, digest: string) => file(`repositories/${repo}/_manifests/revisions/sha256/${digest.slice(7)}/link`, digest);
  const config = await blob('{}'), own = await blob('old exclusive project layer'), shared = await blob('shared original layer'), foreign = await blob('other project exclusive layer');
  const ownManifest = await blob(JSON.stringify({ schemaVersion: 2, config: { digest: config }, layers: [{ digest: own }, { digest: shared }] }));
  const foreignManifest = await blob(JSON.stringify({ schemaVersion: 2, config: { digest: config }, layers: [{ digest: shared }, { digest: foreign }] }));
  await link('apps/original', ownManifest); await link('apps/other', foreignManifest);
  await file('repositories/runtime/projects/original/old-build/image/_uploads/00000000-0000-4000-8000-000000000001/data', 'abandoned upload');
  const query: RegistryInventoryRequest = { key: 'original', rootId: 'local', directory: 'volume', exact: ['apps/original'], prefixes: ['runtime/projects/original'], retainedDigests: [], retainedManifests: [] };
  const path = (digest: string) => join(base, `blobs/sha256/${digest.slice(7, 9)}/${digest.slice(7)}/data`);
  const observe = () => observeRegistryInventory(root, query);
  return { root, base, query, path, file, blob, link, config, own, shared, foreign, ownManifest, foreignManifest, observe, drop: () => rm(root, { recursive: true, force: true }) };
}
const linux = process.platform === 'linux';
const authority = (check: () => Promise<void> = async () => undefined): RegistryReclamationAuthority => ({ exclusive: async (_original, work) => work(), assertClosed: check });

test.skipIf(!linux)('exact descriptor-based removal reclaims old revisions and uploads, preserving shared and foreign bytes and inode identities', async () => {
  const f = await fixture(); try {
    const original = await f.observe(), sharedBefore = await stat(f.path(f.shared), { bigint: true }), foreignBefore = await stat(f.path(f.foreign), { bigint: true });
    const result = await reclaimRegistryInventory(f.root, { query: f.query, original }, authority());
    expect(result).toMatchObject({ kind: 'acknowledged', remainingEntries: 0, remainingExclusiveBlobs: 0, physicalReclamationProven: false });
    expect(result.shared.map(row => row.digest).sort()).toEqual([f.config, f.shared].sort());
    expect(await readFile(f.path(f.shared), 'utf8')).toBe('shared original layer'); expect(await readFile(f.path(f.foreign), 'utf8')).toBe('other project exclusive layer');
    expect((await stat(f.path(f.shared), { bigint: true })).ino).toBe(sharedBefore.ino); expect((await stat(f.path(f.foreign), { bigint: true })).ino).toBe(foreignBefore.ino);
    await expect(stat(f.path(f.own))).rejects.toThrow(); await expect(stat(f.path(f.ownManifest))).rejects.toThrow();
    // A retry with the original graph remains bound to the retained descendants.
    expect((await reclaimRegistryInventory(f.root, { query: f.query, original }, authority())).remainingExclusiveBlobs).toBe(0);
  } finally { await f.drop(); }
});
test.skipIf(!linux)('partial interruption retains all original descendant digests after repository links disappear; retry does not invent empty storage', async () => {
  const f = await fixture(); try {
    const original = await f.observe(); let checks = 0;
    await expect(reclaimRegistryInventory(f.root, { query: f.query, original }, authority(async () => { if (++checks === 8) throw Error('grant revoked'); }))).rejects.toThrow('revoked');
    expect(await readFile(f.path(f.own), 'utf8')).toBe('old exclusive project layer');
    const result = await reclaimRegistryInventory(f.root, { query: f.query, original }, authority());
    expect(result.remainingEntries).toBe(0); expect(result.remainingExclusiveBlobs).toBe(0); expect(result.physicalReclamationProven).toBe(false);
    expect(await readFile(f.path(f.foreign), 'utf8')).toBe('other project exclusive layer');
  } finally { await f.drop(); }
});
test.skipIf(!linux)('a new foreign reference after capture is preserved even when the blob was originally exclusive', async () => {
  const f = await fixture(); try {
    const original = await f.observe(), before = await stat(f.path(f.own), { bigint: true });
    const other = await f.blob(JSON.stringify({ schemaVersion: 2, config: { digest: f.config }, layers: [{ digest: f.own }] })); await f.link('apps/later', other);
    const result = await reclaimRegistryInventory(f.root, { query: f.query, original }, authority());
    expect(result.shared.map(row => row.digest)).toContain(f.own); expect((await stat(f.path(f.own), { bigint: true })).ino).toBe(before.ino);
    expect(await readFile(f.path(f.own), 'utf8')).toBe('old exclusive project layer');
  } finally { await f.drop(); }
});
test.skipIf(!linux)('a foreign nested repository shares its namespace parent; exact repository cleanup leaves that directory and its foreign content', async () => {
  const f = await fixture(); try {
    await f.link('apps/original/other', f.foreignManifest);
    const original = await f.observe(); expect(original.entries.map(row => row.path)).not.toContain('repositories/apps/original');
    const result = await reclaimRegistryInventory(f.root, { query: f.query, original }, authority()); expect(result.remainingEntries).toBe(0);
    expect(await readFile(join(f.base, `repositories/apps/original/other/_manifests/revisions/sha256/${f.foreignManifest.slice(7)}/link`), 'utf8')).toBe(f.foreignManifest);
  } finally { await f.drop(); }
});
test.skipIf(!linux)('a transferred platform catalog version keeps its original repository, shared payload and directory identities inside a project prefix', async () => {
  const f = await fixture(); try {
    const query = { ...f.query, protectedRepositories: ['apps/original'] }, original = await observeRegistryInventory(f.root, query);
    const before = await stat(f.path(f.own), { bigint: true });
    expect(original.entries.every(row => !row.path.startsWith('repositories/apps/original'))).toBe(true);
    const result = await reclaimRegistryInventory(f.root, { query, original }, authority());
    expect(result).toMatchObject({ remainingEntries: 0, remainingExclusiveBlobs: 0, physicalReclamationProven: false });
    expect(await readFile(f.path(f.own), 'utf8')).toBe('old exclusive project layer');
    expect((await stat(f.path(f.own), { bigint: true })).ino).toBe(before.ino);
    expect(await readFile(join(f.base, `repositories/apps/original/_manifests/revisions/sha256/${f.ownManifest.slice(7)}/link`), 'utf8')).toBe(f.ownManifest);
    await expect(stat(join(f.base, 'repositories/runtime/projects/original/old-build/image/_uploads/00000000-0000-4000-8000-000000000001/data'))).rejects.toThrow();
  } finally { await f.drop(); }
});
test.skipIf(!linux)('revoked grants, an active producer, original root replacement and same-name inode replacement cannot erase replacement or foreign bytes', async () => {
  for (const mode of ['revoked', 'writer', 'root', 'inode', 'symlink', 'new owned content']) {
    const f = await fixture(); try {
      const original = await f.observe();
      if (mode === 'root') { await rename(join(f.root, 'volume'), join(f.root, 'retained')); await mkdir(join(f.root, 'volume/docker/registry/v2/repositories'), { recursive: true }); }
      if (mode === 'inode') { await rename(f.path(f.own), f.path(f.own) + '.retained'); await writeFile(f.path(f.own), 'replacement'); }
      if (mode === 'symlink') { await rm(f.path(f.own)); await symlink(f.path(f.foreign), f.path(f.own)); }
      if (mode === 'new owned content') await f.file('repositories/apps/original/_uploads/00000000-0000-4000-8000-000000000002/data', 'newly written project file');
      const guard = authority(async () => { if (['revoked', 'writer'].includes(mode)) throw Error(mode); });
      await expect(reclaimRegistryInventory(f.root, { query: f.query, original }, guard)).rejects.toThrow();
      const foreignPath = mode === 'root' ? f.path(f.foreign).replace('/volume/', '/retained/') : f.path(f.foreign);
      expect(await readFile(foreignPath, 'utf8')).toBe('other project exclusive layer');
      if (mode === 'inode') expect(await readFile(f.path(f.own), 'utf8')).toBe('replacement');
    } finally { await f.drop(); }
  }
});
test('unsupported host and a forged scope fail closed before any native mutation', async () => {
  const f = await fixture(); try {
    const original = await f.observe(), input = { query: { ...f.query, exact: ['apps/other'] }, original };
    await expect(reclaimRegistryInventory(f.root, input, authority())).rejects.toThrow();
    expect(await readFile(f.path(f.own), 'utf8')).toBe('old exclusive project layer');
  } finally { await f.drop(); }
});
