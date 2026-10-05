import { expect, test } from 'bun:test';
import { copyFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Resources } from '@crewstation/k8s';
import { nativeBuildKitSource } from './source';
import { buildKitSourceFixture } from './fixture';

test('binds full native EOF, all four real bbolt databases and selected bytes to the exact original installation; never deletes', async () => {
  const f = await buildKitSourceFixture();
  try {
    const original = await f.source.capture(f.query);
    expect(original.origin).toMatchObject({ podUid: f.ids['pod'], pvcUid: f.ids['pvc'], pvUid: f.ids['pv'], configUid: f.ids['config'], probeUid: f.ids['probe'] });
    expect(original.inventory.databases).toHaveLength(4); expect(original.inventory.files).toHaveLength(4);
    expect(original.native.histories[0]?.classification).toBe('owned'); expect(original.native.usage).toHaveLength(1);
    expect((await f.source.verify(f.query, original)).identity).toBe(original.identity);
    expect(f.methods).not.toContain('Prune'); expect(f.methods).not.toContain('UpdateBuildHistory'); expect(f.k8s.deleted).toHaveLength(0);
    expect(f.urls).toEqual(['http://10.0.0.3:8095/buildkit/inventory', 'http://10.0.0.3:8095/buildkit/inventory']);
    expect(JSON.stringify(original)).not.toContain('original-private-secret');
  } finally { await f.drop(); }
});
for (const mode of ['arguments', 'environment', 'image', 'configuration', 'claim', 'csi', 'subpath', 'overlap', 'stale node', 'missing probe']) test('unsupported ' + mode + ' never becomes an empty or alternate original source', async () => {
  const f = await buildKitSourceFixture();
  try {
    if (mode === 'arguments') f.options.args = ['--root', '/alternate'];
    if (mode === 'image') f.options.imageDigest = 'sha256:' + 'e'.repeat(64);
    if (mode === 'configuration') await f.k8s.mergePatch(Resources.ConfigMap!, 'buildkitd-config', 'system', { data: { 'buildkitd.toml': 'root="/elsewhere"' } });
    if (mode === 'claim') await f.k8s.mergePatch(Resources.PersistentVolume!, 'cache', undefined, { spec: { claimRef: { uid: 'replacement' } } });
    if (mode === 'csi') await f.k8s.mergePatch(Resources.PersistentVolume!, 'cache', undefined, { spec: { csi: { driver: 'unsupported' } } });
    if (['environment', 'subpath', 'overlap'].includes(mode)) {
      const pod = (await f.k8s.get(Resources.Pod!, 'buildkitd', 'system'))!, spec = pod['spec'] as { containers: Array<{ env?: unknown[]; volumeMounts: Array<{ name: string; mountPath: string; subPath?: string }> }> };
      if (mode === 'environment') spec.containers[0]!.env = [{ name: 'HOME', value: '/alternate' }];
      if (mode === 'subpath') spec.containers[0]!.volumeMounts[0]!.subPath = 'partial';
      if (mode === 'overlap') spec.containers[0]!.volumeMounts.push({ name: 'cache', mountPath: f.options.mountPath + '/hidden' });
      await f.k8s.apply(pod);
    }
    if (mode === 'stale node') await f.k8s.mergePatch(Resources.Lease!, 'node', 'kube-node-lease', { spec: { renewTime: '2000-01-01T00:00:00Z' } });
    if (mode === 'missing probe') await f.k8s.delete(Resources.Pod!, 'probe', 'system');
    await expect(nativeBuildKitSource(f.k8s, f.options, f.fetcher, f.transport).capture(f.query)).rejects.toThrow();
    expect(f.urls).toHaveLength(0); expect(f.methods).toHaveLength(0);
  } finally { await f.drop(); }
});
test('byte-identical database replacement is a different birth; missing databases and mid-read probe replacement cannot prove zero', async () => {
  for (const mode of ['database replacement', 'missing database', 'probe replacement']) {
    const f = await buildKitSourceFixture();
    try {
      const original = await f.source.capture(f.query), database = join(f.volume, 'cache.db');
      if (mode === 'database replacement') { await rename(database, database + '.old'); await copyFile(database + '.old', database); }
      if (mode === 'missing database') await rm(database);
      if (mode === 'probe replacement') {
        const fetcher = (async (url, init) => { const result = await f.fetcher(url, init); await f.k8s.mergePatch(Resources.Pod!, 'probe', 'system', { metadata: { uid: 'replaced' } }); return result; }) as typeof fetch;
        await expect(nativeBuildKitSource(f.k8s, f.options, fetcher, f.transport).verify(f.query, original)).rejects.toThrow('期间变化');
      } else await expect(f.source.verify(f.query, original)).rejects.toThrow();
      expect(f.methods).not.toContain('Prune'); expect(f.k8s.deleted).toHaveLength(0);
    } finally { await f.drop(); }
  }
});
