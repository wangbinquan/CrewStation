import { expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { nativeGarageFixture } from './sourceFixture';
import { nativeGarageSource } from './source';

test('formal Garage source binds real native SQLite and block copies to original service, config, node and both PVCs', async () => {
  const f = await nativeGarageFixture();
  try {
    const result = await f.adapter.capture(f.query);
    expect(result.origin).toMatchObject({ podUid: 'original-garage', nodeUid: 'original-node', metadata: { pvcUid: 'original-pvc-meta', pvUid: 'original-pv-meta' }, data: { pvcUid: 'original-pvc-data', pvUid: 'original-pv-data' } });
    expect(result.inventory.blocks.copies).toHaveLength(1); expect(result.inventory.metadata.references[0]?.owned).toBe(false);
    expect(result.inventory.metadata.physicalReclamationProven).toBe(false); expect(JSON.stringify(result)).not.toContain('private');
    expect((await f.adapter.verify(f.query, result)).identity).toBe(result.identity);
  } finally { await f.drop(); }
});
test('current same-name config, unproven startup overrides, partial mount and CSI source cannot supply original completeness', async () => {
  for (const mode of ['new config', 'unknown config birth', 'secret override', 'engine', 'replicas', 'partial mount', 'CSI']) {
    const f = await nativeGarageFixture();
    try {
      if (mode === 'new config') await f.k8s.mergePatch(Resources.ConfigMap!, 'garage-config', 'system', { metadata: { managedFields: [{ time: '2026-03-01T00:00:00Z' }] } });
      if (mode === 'unknown config birth') await f.k8s.mergePatch(Resources.ConfigMap!, 'garage-config', 'system', { metadata: { managedFields: null } });
      if (mode === 'secret override') await f.k8s.mergePatch(Resources.Secret!, 'garage-credentials', 'system', { data: { GARAGE_METADATA_DIR: 'eA==' } });
      if (mode === 'engine' || mode === 'replicas') {
        const config = (await f.k8s.get(Resources.ConfigMap!, 'garage-config', 'system'))!, data = config['data'] as Record<string, string>;
        data['garage.toml'] = data['garage.toml']!.replace(mode === 'engine' ? '"sqlite"' : 'replication_factor=1', mode === 'engine' ? '"lmdb"' : 'replication_factor=3'); await f.k8s.apply(config);
      }
      if (mode === 'partial mount') {
        const pod = (await f.k8s.get(Resources.Pod!, 'garage-0', 'system'))!, spec = pod['spec'] as { containers: Array<{ volumeMounts: Array<{ subPath?: string }> }> };
        spec.containers[0]!.volumeMounts[0]!.subPath = 'partial'; await f.k8s.apply(pod);
      }
      if (mode === 'CSI') await f.k8s.mergePatch(Resources.PersistentVolume!, 'garage-pv-meta', undefined, { spec: { csi: { driver: 'unknown' } } });
      await expect(f.adapter.capture(f.query)).rejects.toThrow();
    } finally { await f.drop(); }
  }
});
test('a replacement during native observation is refused; caller mutations cannot change the frozen space query', async () => {
  const f = await nativeGarageFixture();
  try {
    const requests: unknown[] = [];
    const replacing = nativeGarageSource(f.k8s, f.options, (async (url, init) => {
      const response = await f.fetcher(url, init); await f.k8s.mergePatch(Resources.Secret!, 'garage-credentials', 'system', { metadata: { uid: 'replacement-credentials' } }); return response;
    }) as typeof fetch);
    await expect(replacing.capture(f.query)).rejects.toThrow();
    const get = f.k8s.get.bind(f.k8s); let release!: () => void, entered!: () => void, first = true;
    const paused = new Promise<void>(resolve => { release = resolve; }), reading = new Promise<void>(resolve => { entered = resolve; });
    const client = { ...f.k8s, get: (async (...args: Parameters<typeof get>) => { if (first) { first = false; entered(); await paused; } return get(...args); }) as typeof get };
    const scoped = nativeGarageSource(client, f.options, (async (url, init) => { requests.push(JSON.parse(String(init?.body))); return f.fetcher(url, init); }) as typeof fetch);
    const pending = scoped.capture(f.query); await reading; f.query.spaceIds[0] = f.sibling; release(); const original = await pending;
    expect(requests[0]).toMatchObject({ query: { spaceIds: [f.space] } }); expect(original.inventory.blocks.copies).toHaveLength(1);
  } finally { await f.drop(); }
});
