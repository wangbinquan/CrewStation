import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFakeK8sClient } from '@crewstation/k8s';
import { createFilesystemMetricsHandler } from '@crewstation/filesystem-metrics';
import { garageMetadataFixture } from '../../../../../packages/filesystem-metrics/garage/fixture';
import { nativeGarageSource } from './source';

export async function nativeGarageFixture() {
  const f = await garageMetadataFixture(), data = 'original-data'; await mkdir(join(f.root, data));
  await writeFile(join(f.root, data, f.block.toString('hex')), 'original');
  f.insert('version', { uuid: f.original, deleted: false, backlink: { Object: { bucket_id: f.bucket, key: `spaces/${f.space}/attempts/old` } }, blocks: [[{ part_number: 1, offset: 0 }, { hash: f.block, size: 8 }]] });
  f.insert('block_ref', { block: f.block, version: f.foreign, deleted: false });
  const k8s = createFakeK8sClient(), token = 'garage-native-source-token-1234567890';
  await k8s.apply({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'system', uid: 'original-system' } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Service', metadata: { name: 'garage', namespace: 'system', uid: 'original-service' }, spec: { selector: { app: 'garage' }, ports: [{ port: 3903 }] } });
  await k8s.apply({ apiVersion: 'discovery.k8s.io/v1', kind: 'EndpointSlice', metadata: { name: 'garage-endpoints', namespace: 'system', uid: 'original-endpoints', labels: { 'kubernetes.io/service-name': 'garage' }, ownerReferences: [{ apiVersion: 'v1', kind: 'Service', name: 'garage', uid: 'original-service' }] }, ports: [{ port: 3903 }], endpoints: [{ addresses: ['10.0.0.2'], conditions: { ready: true }, targetRef: { kind: 'Pod', namespace: 'system', name: 'garage-0', uid: 'original-garage' } }] });
  await k8s.apply({ apiVersion: 'v1', kind: 'Node', metadata: { name: 'node', uid: 'original-node' }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.34.0' } } });
  await k8s.apply({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', metadata: { name: 'node', namespace: 'kube-node-lease', ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: 'node', uid: 'original-node' }] }, spec: { holderIdentity: 'node', renewTime: new Date().toISOString() } });
  const before = '2026-01-01T00:00:00Z', originalConfig = { creationTimestamp: before, managedFields: [{ time: before }] };
  await k8s.apply({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'garage-config', namespace: 'system', uid: 'original-config', ...originalConfig }, data: { 'garage.toml': 'metadata_dir="/storage/meta"\ndata_dir="/storage/data"\ndb_engine="sqlite"\nreplication_factor=1\nconsistency_mode="consistent"\n[admin]\napi_bind_addr="0.0.0.0:3903"' } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'garage-credentials', namespace: 'system', uid: 'original-credentials', ...originalConfig }, data: { GARAGE_ADMIN_TOKEN: Buffer.from('private').toString('base64') } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'garage-0', namespace: 'system', uid: 'original-garage', labels: { app: 'garage' } }, spec: { nodeName: 'node', volumes: [{ name: 'metadata', persistentVolumeClaim: { claimName: 'garage-meta' } }, { name: 'data', persistentVolumeClaim: { claimName: 'garage-data' } }, { name: 'config', configMap: { name: 'garage-config' } }], containers: [{ name: 'garage', command: ['/garage'], args: ['server', '--single-node', '--default-bucket'], envFrom: [{ secretRef: { name: 'garage-credentials' } }], volumeMounts: [{ name: 'metadata', mountPath: '/storage/meta' }, { name: 'data', mountPath: '/storage/data' }, { name: 'config', mountPath: '/etc/garage.toml', readOnly: true, subPath: 'garage.toml' }] }] }, status: { podIP: '10.0.0.2', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: 'garage', containerID: 'containerd://' + 'c'.repeat(64), imageID: 'docker.io/dxflrs/garage@sha256:' + 'd'.repeat(64), ready: true, state: { running: { startedAt: '2026-02-01T00:00:00Z' } } }] } });
  for (const [kind, directory] of [['meta', f.directory], ['data', data]]) {
    await k8s.apply({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'garage-' + kind, namespace: 'system', uid: 'original-pvc-' + kind }, spec: { volumeName: 'garage-pv-' + kind } });
    await k8s.apply({ apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: 'garage-pv-' + kind, uid: 'original-pv-' + kind, annotations: { 'pv.kubernetes.io/provisioned-by': 'rancher.io/local-path', 'local.path.provisioner/selected-node': 'node' } }, spec: { claimRef: { uid: 'original-pvc-' + kind, name: 'garage-' + kind, namespace: 'system' }, hostPath: { path: join(f.root, directory!) } } });
  }
  await k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'probe', namespace: 'system', uid: 'original-probe', labels: { app: 'cs-storage-probe' } }, spec: { nodeName: 'node', volumes: [{ name: 'source', hostPath: { path: f.root, type: 'Directory' } }], containers: [{ name: 'probe', volumeMounts: [{ name: 'source', mountPath: '/volumes', readOnly: true }] }] }, status: { podIP: '10.0.0.3', conditions: [{ type: 'Ready', status: 'True' }] } });
  const handler = createFilesystemMetricsHandler({ token, roots: { local: f.root } });
  const fetcher = (async (url, init) => handler(new Request(String(url), init))) as typeof fetch;
  const options = { namespace: 'system', service: 'garage', port: 3903, container: 'garage', imageDigest: 'sha256:' + 'd'.repeat(64), probeRoot: f.root, probePort: 8095, probeToken: token };
  return { ...f, k8s, options, fetcher, adapter: nativeGarageSource(k8s, options, fetcher), drop: async () => { await f.dispose(); await rm(f.root, { recursive: true, force: true }); } };
}
