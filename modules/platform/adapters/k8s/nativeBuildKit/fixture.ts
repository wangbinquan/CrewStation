import { randomUUID } from 'node:crypto';
import { createFakeK8sClient } from '@crewstation/k8s';
import { createFilesystemMetricsHandler } from '@crewstation/filesystem-metrics';
import { jsonHash } from '@crewstation/kernel';
import { buildKitFilesFixture, cacheId, workerId } from '../../../../../packages/filesystem-metrics/buildkit/inventory/fixture';
import { protoMessage } from '../../../../../packages/filesystem-metrics/buildkit/protobuf';
import { nativeBuildKitSource } from './source';
import type { BuildKitSourceOptions } from './origin';

export async function buildKitSourceFixture() {
  const files = await buildKitFilesFixture(), k8s = createFakeK8sClient(), ids = Object.fromEntries(['namespace', 'service', 'pod', 'probe', 'node', 'config', 'pvc', 'pv'].map(key => [key, randomUUID()]));
  const data = { 'buildkitd.toml': '[worker.oci]\nsnapshotter="overlayfs"\n' }, options: BuildKitSourceOptions = { namespace: 'system', service: 'buildkitd', container: 'buildkitd', port: 1234,
    imageDigest: 'sha256:' + 'a'.repeat(64), probeRoot: files.root, probePort: 8095, probeToken: 'original-buildkit-source-token-123456789',
    mountPath: '/home/user/.local/share/buildkit', args: ['--addr', 'tcp://0.0.0.0:1234'], configMap: 'buildkitd-config', configIdentity: jsonHash(data) };
  await k8s.apply({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'system', uid: ids['namespace'] } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Service', metadata: { name: 'buildkitd', namespace: 'system', uid: ids['service'] }, spec: { selector: { app: 'buildkitd' }, ports: [{ port: 1234 }] } });
  await k8s.apply({ apiVersion: 'discovery.k8s.io/v1', kind: 'EndpointSlice', metadata: { name: 'buildkitd', namespace: 'system', uid: randomUUID(), labels: { 'kubernetes.io/service-name': 'buildkitd' },
    ownerReferences: [{ apiVersion: 'v1', kind: 'Service', name: 'buildkitd', uid: ids['service']! }] }, ports: [{ port: 1234 }], endpoints: [{ addresses: ['10.0.0.2'], conditions: { ready: true }, targetRef: { kind: 'Pod', name: 'buildkitd', namespace: 'system', uid: ids['pod'] } }] });
  await k8s.apply({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'buildkitd-config', namespace: 'system', uid: ids['config'] }, data });
  await k8s.apply({ apiVersion: 'v1', kind: 'Node', metadata: { name: 'node', uid: ids['node'] }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.34.0' } } });
  await k8s.apply({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', metadata: { name: 'node', namespace: 'kube-node-lease', ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: 'node', uid: ids['node']! }] }, spec: { holderIdentity: 'node', renewTime: new Date().toISOString() } });
  await k8s.apply({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'cache', namespace: 'system', uid: ids['pvc'] }, spec: { volumeName: 'cache' } });
  await k8s.apply({ apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: 'cache', uid: ids['pv'], annotations: { 'pv.kubernetes.io/provisioned-by': 'rancher.io/local-path', 'local.path.provisioner/selected-node': 'node' } },
    spec: { claimRef: { uid: ids['pvc'], name: 'cache', namespace: 'system' }, hostPath: { path: files.volume } } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'buildkitd', namespace: 'system', uid: ids['pod'], labels: { app: 'buildkitd' } },
    spec: { nodeName: 'node', volumes: [{ name: 'cache', persistentVolumeClaim: { claimName: 'cache' } }, { name: 'config', configMap: { name: options.configMap } }],
      containers: [{ name: 'buildkitd', args: options.args, volumeMounts: [{ name: 'cache', mountPath: options.mountPath }, { name: 'config', mountPath: '/etc/buildkit', readOnly: true }] }] },
    status: { podIP: '10.0.0.2', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: 'buildkitd', containerID: 'containerd://' + 'b'.repeat(64), imageID: 'buildkit@' + options.imageDigest, ready: true, state: { running: {} } }] } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'probe', namespace: 'system', uid: ids['probe'], labels: { app: 'cs-storage-probe' } },
    spec: { nodeName: 'node', volumes: [{ name: 'data', hostPath: { path: files.root, type: 'Directory' } }], containers: [{ name: 'probe', volumeMounts: [{ name: 'data', mountPath: '/volumes', readOnly: true }] }] },
    status: { podIP: '10.0.0.3', conditions: [{ type: 'Ready', status: 'True' }] } });
  const handler = createFilesystemMetricsHandler({ token: options.probeToken, roots: { local: files.root } }), urls: string[] = [], methods: string[] = [];
  const fetcher = (async (url, init) => { urls.push(String(url)); return handler(new Request(String(url), init)); }) as typeof fetch;
  const version = protoMessage([{ number: 1, value: 'github.com/moby/buildkit' }, { number: 2, value: 'v0.33.0' }, { number: 3, value: 'c'.repeat(40) }]);
  const timestamp = protoMessage([{ number: 1, value: 1790784077n }, { number: 2, value: 263787585n }]);
  const record = protoMessage([{ number: 1, value: 'd'.repeat(25) }, { number: 6, value: timestamp }, { number: 7, value: timestamp }, { number: 4, value: protoMessage([
    { number: 1, value: 'image' }, { number: 2, value: protoMessage([{ number: 1, value: 'name' }, { number: 2, value: 'registry:5000/project:v1' }]) }]) }]);
  const transport: Parameters<typeof nativeBuildKitSource>[3] = () => async method => {
    methods.push(method);
    if (method === 'Info') return [protoMessage([{ number: 1, value: version }])];
    if (method === 'ListWorkers') return [protoMessage([{ number: 1, value: protoMessage([{ number: 1, value: workerId }, { number: 5, value: version }]) }])];
    if (method === 'DiskUsage') return [protoMessage([{ number: 1, value: protoMessage([{ number: 1, value: cacheId }, { number: 6, value: timestamp }]) }])];
    if (method === 'ListenBuildHistory') return [protoMessage([{ number: 1, value: 1n }, { number: 2, value: record }])];
    throw Error('Read-only source invoked a native mutation');
  };
  const query = { files: { storageIds: files.request.storageIds, contentDigests: files.request.contentDigests }, history: { exact: ['registry:5000/project'], prefixes: [], protectedRepositories: [] } };
  return { ...files, k8s, ids, options, fetcher, transport, methods, urls, query, source: nativeBuildKitSource(k8s, options, fetcher, transport) };
}
