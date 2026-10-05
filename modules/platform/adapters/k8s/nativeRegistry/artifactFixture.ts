import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createFakeK8sClient } from '@crewstation/k8s';
import { createFilesystemMetricsHandler } from '@crewstation/filesystem-metrics';
import { nativeRegistryArtifacts } from './artifacts';

export async function registryArtifactFixture(procRoot: string, repository = 'apps/original') {
  const root = await mkdtemp(join(tmpdir(), 'cs-registry-artifacts-')), base = join(root, 'volume/docker/registry/v2'), k8s = createFakeK8sClient();
  const ids = { namespace: randomUUID(), service: randomUUID(), pod: randomUUID(), node: randomUUID(), pvc: randomUUID(), pv: randomUUID(), probe: randomUUID() };
  const token = 'original-registry-artifact-token-1234567890';
  const file = async (path: string, bytes: string) => { const full = join(base, path); await mkdir(dirname(full), { recursive: true }); await writeFile(full, bytes); };
  const blob = async (bytes: string) => { const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex'); await file(`blobs/sha256/${digest.slice(7, 9)}/${digest.slice(7)}/data`, bytes); return digest; };
  const config = await blob('{}'), layer = await blob('original project layer'), manifest = await blob(JSON.stringify({ schemaVersion: 2, config: { digest: config }, layers: [{ digest: layer }] }));
  await file(`repositories/${repository}/_manifests/revisions/sha256/${manifest.slice(7)}/link`, manifest);
  await k8s.apply({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'system', uid: ids.namespace } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Service', metadata: { name: 'registry', namespace: 'system', uid: ids.service }, spec: { selector: { app: 'registry' }, ports: [{ port: 5000 }] } });
  await k8s.apply({ apiVersion: 'discovery.k8s.io/v1', kind: 'EndpointSlice', metadata: { name: 'registry', namespace: 'system', uid: randomUUID(), labels: { 'kubernetes.io/service-name': 'registry' }, ownerReferences: [{ apiVersion: 'v1', kind: 'Service', name: 'registry', uid: ids.service }] }, ports: [{ port: 5000 }], endpoints: [{ addresses: ['10.0.0.2'], conditions: { ready: true }, targetRef: { kind: 'Pod', namespace: 'system', name: 'registry', uid: ids.pod } }] });
  await k8s.apply({ apiVersion: 'v1', kind: 'Node', metadata: { name: 'node', uid: ids.node }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.34.0' } } });
  await k8s.apply({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', metadata: { name: 'node', namespace: 'kube-node-lease', ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: 'node', uid: ids.node }] }, spec: { holderIdentity: 'node', renewTime: new Date().toISOString() } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'registry', namespace: 'system', uid: ids.pod, labels: { app: 'registry' } },
    spec: { nodeName: 'node', volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'registry' } }], containers: [{ name: 'registry', env: [{ name: 'REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY', value: '/var/lib/registry' }], volumeMounts: [{ name: 'data', mountPath: '/var/lib/registry' }] }] },
    status: { podIP: '10.0.0.2', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: 'registry', containerID: 'containerd://' + 'c'.repeat(64), imageID: 'registry@sha256:' + 'd'.repeat(64), ready: true, state: { running: {} } }] } });
  await k8s.apply({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'registry', namespace: 'system', uid: ids.pvc }, spec: { volumeName: 'registry' } });
  await k8s.apply({ apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: 'registry', uid: ids.pv, annotations: { 'pv.kubernetes.io/provisioned-by': 'rancher.io/local-path', 'local.path.provisioner/selected-node': 'node' } }, spec: { claimRef: { uid: ids.pvc, name: 'registry', namespace: 'system' }, hostPath: { path: join(root, 'volume') } } });
  await k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'probe', namespace: 'system', uid: ids.probe, labels: { app: 'cs-storage-probe' } },
    spec: { nodeName: 'node', hostPID: true, volumes: [{ name: 'source', hostPath: { path: root, type: 'Directory' } }], containers: [{ name: 'probe', volumeMounts: [{ name: 'source', mountPath: '/volumes', readOnly: true }], securityContext: { runAsUser: 0, readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, capabilities: { add: ['SYS_PTRACE', 'DAC_READ_SEARCH'] } } }] },
    status: { podIP: '10.0.0.3', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: 'probe', ready: true, state: { running: {} }, containerID: 'containerd://' + 'a'.repeat(64), imageID: 'probe@sha256:' + 'b'.repeat(64) }] } });
  const handler = createFilesystemMetricsHandler({ token, roots: { local: root }, procRoot }), calls: string[] = [];
  const fetcher = (async (url, init) => { calls.push(String(url)); return handler(new Request(String(url), init)); }) as typeof fetch;
  const source = nativeRegistryArtifacts(k8s, { namespace: 'system', service: 'registry', container: 'registry', port: 5000, imageDigest: 'sha256:' + 'd'.repeat(64), probeRoot: root, probePort: 8095, probeToken: token }, fetcher);
  const path = (digest: string) => join(base, `blobs/sha256/${digest.slice(7, 9)}/${digest.slice(7)}/data`);
  return { root, base, k8s, ids, source, config, layer, manifest, path, calls, query: { exact: ['apps/original'], prefixes: [], retainedDigests: [], retainedManifests: [] }, drop: () => rm(root, { recursive: true, force: true }) };
}
