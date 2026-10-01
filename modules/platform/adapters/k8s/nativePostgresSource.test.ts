import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rename, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFilesystemMetricsHandler } from '@crewstation/filesystem-metrics';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { nativePostgresSource } from './nativePostgresSource';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cs-native-source-')); roots.push(root);
  await mkdir(join(root, 'volume/pgdata/global'), { recursive: true }); await writeFile(join(root, 'volume/pgdata/global/pg_control'), 'same SQL source');
  const k8s = createFakeK8sClient(), token = 's'.repeat(48);
  await k8s.apply({ apiVersion: 'v1', kind: 'Service', metadata: { name: 'postgres', namespace: 'system', uid: 'service' }, spec: { ports: [{ port: 5432, targetPort: 5432 }] } });
  await k8s.apply({ apiVersion: 'discovery.k8s.io/v1', kind: 'EndpointSlice', metadata: { name: 'postgres-endpoints', namespace: 'system', uid: 'slice', labels: { 'kubernetes.io/service-name': 'postgres' }, ownerReferences: [{ apiVersion: 'v1', kind: 'Service', name: 'postgres', uid: 'service' }] }, ports: [{ port: 5432 }], endpoints: [{ addresses: ['10.0.0.2'], conditions: { ready: true }, targetRef: { kind: 'Pod', namespace: 'system', name: 'postgres-0', uid: 'postgres-pod' } }] });
  await k8s.apply({ apiVersion: 'v1', kind: 'Node', metadata: { name: 'node', uid: 'node-original' }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.34.0' } } });
  await k8s.apply({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', metadata: { name: 'node', namespace: 'kube-node-lease', ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: 'node', uid: 'node-original' }] }, spec: { holderIdentity: 'node', renewTime: new Date().toISOString() } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'postgres-0', namespace: 'system', uid: 'postgres-pod' }, spec: { nodeName: 'node', volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'data-postgres-0' } }], containers: [{ name: 'postgres', volumeMounts: [{ name: 'data', mountPath: '/data' }] }] }, status: { podIP: '10.0.0.2', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: 'postgres', containerID: 'containerd://postgres-original', ready: true, state: { running: {} } }] } });
  await k8s.apply({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'data-postgres-0', namespace: 'system', uid: 'pvc-original' }, spec: { volumeName: 'pv' } });
  await k8s.apply({ apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: 'pv', uid: 'pv-original', annotations: { 'pv.kubernetes.io/provisioned-by': 'rancher.io/local-path', 'local.path.provisioner/selected-node': 'node' } }, spec: { claimRef: { uid: 'pvc-original', name: 'data-postgres-0', namespace: 'system' }, hostPath: { path: join(root, 'volume') } } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'probe', namespace: 'system', uid: 'probe-original', labels: { app: 'cs-storage-probe' } }, spec: { nodeName: 'node', volumes: [{ name: 'source', hostPath: { path: root, type: 'Directory' } }], containers: [{ name: 'probe', volumeMounts: [{ name: 'source', mountPath: '/volumes', readOnly: true }] }] }, status: { podIP: '10.0.0.3', conditions: [{ type: 'Ready', status: 'True' }] } });
  const handler = createFilesystemMetricsHandler({ token, roots: { local: root } }), options = { namespace: 'system', service: 'postgres', adminUrl: 'postgres://private@postgres.system.svc:5432/postgres', probeRoot: root, probePort: 8095, probeToken: token };
  const server = { address: '10.0.0.2', port: 5432, directory: '/data/pgdata', system_identifier: '12345', pg_control_version: 1700, catalog_version_no: 202406281 }, spaces: Array<{ oid: string; location: string }> = [];
  const connection = { query: async <T extends Record<string, unknown>[]>(sql: string): Promise<T> => structuredClone(sql.includes('pg_tablespace') ? spaces : [server]) as unknown as T, assertHeld: async () => {} };
  const fetcher = (async (url, init) => handler(new Request(String(url), init))) as typeof fetch;
  return { root, k8s, options, server, spaces, connection, fetcher, adapter: nativePostgresSource(k8s, options, fetcher) };
}
test('independent epochs bind the actual SQL endpoint, original PVC/PV and read-only source, while normal server restart keeps volume identity', async () => {
  const f = await fixture(), original = await f.adapter.capture(f.connection);
  expect(original.volumes).toHaveLength(1); expect(original.volumes[0]).toMatchObject({ pvcUid: 'pvc-original', pvUid: 'pv-original', nodeUid: 'node-original' });
  expect(original.server).toMatchObject({ podUid: 'postgres-pod', containerId: 'containerd://postgres-original' });
  await f.adapter.verify(f.connection, original);
  await f.k8s.mergePatch(Resources.Pod!, 'postgres-0', 'system', { metadata: { uid: 'postgres-restarted' }, status: { containerStatuses: [{ name: 'postgres', containerID: 'containerd://restarted', ready: true, state: { running: {} } }] } });
  const ref = { apiVersion: 'discovery.k8s.io/v1', kind: 'EndpointSlice', plural: 'endpointslices', namespaced: true };
  await f.k8s.mergePatch(ref, 'postgres-endpoints', 'system', { endpoints: [{ addresses: ['10.0.0.2'], conditions: { ready: true }, targetRef: { kind: 'Pod', namespace: 'system', name: 'postgres-0', uid: 'postgres-restarted' } }] });
  const restarted = await f.adapter.capture(f.connection); expect(restarted.identity).toBe(original.identity); expect(restarted.server.podUid).not.toBe(original.server.podUid);
  expect(f.k8s.deleted).toHaveLength(0);
});
test('same SQL source with a copied control file, replacement local directory or replacement PV cannot verify the original', async () => {
  for (const mode of ['control', 'directory', 'pv']) {
    const f = await fixture(), original = await f.adapter.capture(f.connection);
    if (mode === 'control') { await copyFile(join(f.root, 'volume/pgdata/global/pg_control'), join(f.root, 'copy')); await rename(join(f.root, 'copy'), join(f.root, 'volume/pgdata/global/pg_control')); }
    if (mode === 'directory') { await rename(join(f.root, 'volume'), join(f.root, 'old')); await mkdir(join(f.root, 'volume/pgdata/global'), { recursive: true }); await copyFile(join(f.root, 'old/pgdata/global/pg_control'), join(f.root, 'volume/pgdata/global/pg_control')); }
    if (mode === 'pv') await f.k8s.mergePatch(Resources.PersistentVolume!, 'pv', undefined, { metadata: { uid: 'replacement-pv' } });
    await expect(f.adapter.verify(f.connection, original)).rejects.toThrow('已替换'); expect(f.k8s.deleted).toHaveLength(0);
  }
});
test('every native tablespace is included in the original volume epoch, and a replacement at the same SQL location blocks verification', async () => {
  const f = await fixture(); f.spaces.push({ oid: '123', location: '/data/tablespace' });
  await mkdir(join(f.root, 'volume/tablespace'));
  const original = await f.adapter.capture(f.connection);
  expect(original.volumes[0]!.entries.map((entry) => entry.key)).toEqual(['pgdata', 'control', 'tablespace:123']);
  await rename(join(f.root, 'volume/tablespace'), join(f.root, 'volume/previous-tablespace')); await mkdir(join(f.root, 'volume/tablespace'));
  await expect(f.adapter.verify(f.connection, original)).rejects.toThrow('已替换');
});
test('unknown endpoints, external tablespaces, CSI providers, partial claims and stale nodes block original-source capture', async () => {
  for (const mode of ['external', 'address', 'space', 'csi', 'claim', 'stale', 'probe', 'container']) {
    const f = await fixture();
    if (mode === 'external') f.options.adminUrl = 'postgres://private@external.invalid/postgres';
    if (mode === 'address') f.server.address = '10.0.0.99';
    if (mode === 'space') f.spaces.push({ oid: '123', location: '/unknown-space' });
    if (mode === 'csi') await f.k8s.mergePatch(Resources.PersistentVolume!, 'pv', undefined, { spec: { csi: { driver: 'unknown', volumeHandle: 'original' } } });
    if (mode === 'claim') await f.k8s.mergePatch(Resources.PersistentVolume!, 'pv', undefined, { spec: { claimRef: { uid: 'different' } } });
    if (mode === 'stale') await f.k8s.mergePatch(Resources.Lease!, 'node', 'kube-node-lease', { spec: { renewTime: '2000-01-01T00:00:00Z' } });
    if (mode === 'probe') await f.k8s.delete(Resources.Pod!, 'probe', 'system');
    if (mode === 'container') await f.k8s.mergePatch(Resources.Pod!, 'postgres-0', 'system', { status: { containerStatuses: [{ name: 'postgres', ready: true, state: { running: {} } }] } });
    await expect(f.adapter.capture(f.connection)).rejects.toThrow();
  }
});
test('complete endpoint paging and exact source response reject repeated cursors, stale receipts, lost probes and server changes', async () => {
  const f = await fixture(), listPage = f.k8s.listPage.bind(f.k8s); let pages = 0;
  const paged = { ...f.k8s, listPage: (async (...args: Parameters<typeof listPage>) => {
    if (args[0].kind !== 'EndpointSlice') return listPage(...args);
    pages += 1; const page = await listPage(args[0], args[1], { ...args[2], continue: undefined }); return { ...page, items: args[2]?.continue ? page.items : [], continue: args[2]?.continue ? '' : 'next' };
  }) as typeof listPage };
  expect((await nativePostgresSource(paged, f.options, f.fetcher).capture(f.connection)).identity).toMatch(/^[a-f0-9]{64}$/); expect(pages).toBe(4);
  const repeated = { ...f.k8s, listPage: (async (...args: Parameters<typeof listPage>) => ({ ...await listPage(...args), continue: 'repeat' })) as typeof listPage };
  await expect(nativePostgresSource(repeated, f.options, f.fetcher).capture(f.connection)).rejects.toThrow('分页');
  for (const mode of ['stale', 'missing-entry', 'probe-replaced', 'server-changed', 'offline']) {
    const g = await fixture(), fetcher = (async (url, init) => {
      if (mode === 'offline') return new Response(null, { status: 503 });
      const response = await g.fetcher(url, init), body = await response.json();
      if (mode === 'stale') body.observedAt = '2000-01-01T00:00:00Z';
      if (mode === 'missing-entry') body.items.pop();
      if (mode === 'probe-replaced') await g.k8s.mergePatch(Resources.Pod!, 'probe', 'system', { metadata: { uid: 'new-probe' } });
      if (mode === 'server-changed') g.server.system_identifier = 'changed';
      return Response.json(body);
    }) as typeof fetch;
    await expect(nativePostgresSource(g.k8s, g.options, fetcher).capture(g.connection)).rejects.toThrow();
  }
});
test('only the actual source endpoint 409 classifies shared measurement contention; 503 remains unavailable', async () => {
  const f = await fixture();
  for (const status of [409, 503]) {
    const fetcher = (async (_url, _init) => new Response(null, { status })) as typeof fetch;
    const error = await nativePostgresSource(f.k8s, f.options, fetcher).capture(f.connection).then(() => null, (error: unknown) => error);
    expect(error).toMatchObject({ kind: 'precondition', details: { code: status === 409 ? 'native_postgres_source_busy' : 'native_postgres_source_unavailable' } });
  }
});
test('unregistered external endpoints and CSI providers are explicitly unsupported, while stale known sources stay unavailable', async () => {
  for (const mode of ['external', 'csi', 'stale']) {
    const f = await fixture();
    if (mode === 'external') f.options.adminUrl = 'postgres://private@external.invalid/postgres';
    if (mode === 'csi') await f.k8s.mergePatch(Resources.PersistentVolume!, 'pv', undefined, { spec: { csi: { driver: 'unknown', volumeHandle: 'original' } } });
    if (mode === 'stale') await f.k8s.mergePatch(Resources.Lease!, 'node', 'kube-node-lease', { spec: { renewTime: '2000-01-01T00:00:00Z' } });
    const error = await f.adapter.capture(f.connection).then(() => null, (error: unknown) => error);
    expect(error).toMatchObject({ kind: 'precondition', details: { code: mode === 'stale' ? 'native_postgres_source_unavailable' : 'native_postgres_source_unsupported' } });
  }
});
