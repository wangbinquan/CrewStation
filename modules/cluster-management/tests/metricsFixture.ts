import { newResourceId } from '@crewstation/kernel';
import type { ClusterHistoryResource } from '@crewstation/contracts';
import type { MetricsDeps } from '../application/observeMetrics';
import type { MetricsObservation, MetricsTopology, StorageResult } from '../domain/observations';
import type { InventorySnapshot, ResourceObject } from '../domain/inventory';
import type { ClusterRepository } from '../ports/repository';
import { projectResources } from '../domain/projection';
import { object, facts, catalog, resourceIds } from './inventoryFixture';

export function metricsFixture() {
  let now = Date.parse('2026-09-21T10:00:00Z'), observation: MetricsObservation | undefined, storage: StorageResult[] = [], identities: ClusterHistoryResource[] = [];
  const node: ResourceObject = { ...object('Node', 'node-a', '', {}), status: { capacity: { cpu: '10', memory: '16Gi', 'ephemeral-storage': '100Gi', pods: '110', 'example.com/gpu': '2' }, allocatable: { cpu: '9', memory: '15Gi', 'ephemeral-storage': '90Gi', pods: '110', 'example.com/gpu': '2' }, conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.36.1' } } };
  node.metadata.labels = { 'kubernetes.io/hostname': 'node-a', 'node-role.kubernetes.io/control-plane': '' };
  const pod: ResourceObject = { ...object('Pod', 'app', 'cs-demo', { nodeName: 'node-a', containers: [{ name: 'app', image: 'app:v1', resources: { requests: { cpu: '250m', memory: '128Mi' }, limits: { cpu: '1', memory: '256Mi' } } }], volumes: [{ name: 'work', persistentVolumeClaim: { claimName: 'work' } }] }), status: { phase: 'Running', qosClass: 'Burstable', containerStatuses: [{ name: 'app', containerID: 'container-1', state: { running: { startedAt: '2026-09-21T09:59:00Z' } } }] } };
  const pending = { ...object('Pod', 'pending', 'cs-demo', { containers: [{ name: 'app', resources: { requests: { cpu: '2' } } }] }), status: { phase: 'Pending' } };
  const completed = { ...object('Pod', 'done', 'cs-demo', { nodeName: 'node-a', containers: [{ name: 'app', resources: { requests: { cpu: '100' } } }] }), status: { phase: 'Succeeded' } };
  const outside = { ...object('Pod', 'outside', 'kube-system', { nodeName: 'node-a', containers: [{ name: 'system', resources: { requests: { cpu: '1' } } }] }), status: { phase: 'Running' } };
  const probe = { ...object('Pod', 'probe', 'crewstation-system', { nodeName: 'node-a' }), status: { phase: 'Running', podIP: '10.0.0.20', conditions: [{ type: 'Ready', status: 'True' }] } }; probe.metadata.labels = { app: 'cs-storage-probe' };
  const pvc: ResourceObject = { ...object('PersistentVolumeClaim', 'work', 'cs-demo', { volumeName: 'pv-work', storageClassName: 'standard', accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '1Gi' } } }), status: { phase: 'Bound', capacity: { storage: '1Gi' } } };
  const volume = object('PersistentVolume', 'pv-work', '', { claimRef: { name: pvc.metadata.name, namespace: pvc.metadata.namespace, uid: pvc.metadata.uid }, hostPath: { path: '/local/work' }, nodeAffinity: { required: { nodeSelectorTerms: [{ matchExpressions: [{ key: 'kubernetes.io/hostname', operator: 'In', values: ['node-a'] }] }] } } });
  const topology: MetricsTopology = { nodes: [node], pods: [pod, pending, completed, outside, probe], pvcs: [pvc], volumes: [volume] };
  const objects = [...topology.pods, pvc], ids = new Map(resourceIds(objects));
  const inventory: InventorySnapshot = { id: newResourceId(), startedAt: new Date(now).toISOString(), finishedAt: new Date(now).toISOString(), sources: [], facts, resources: projectResources(objects, facts, 'crewstation-system', catalog, new Date(now).toISOString(), ids) };
  const unused = async (): Promise<never> => { throw new Error('Unexpected inventory mutation'); };
  const inventoryRepository: ClusterRepository = { snapshot: unused, saveSnapshot: unused, requestRefresh: unused, finishRefresh: unused, saveInspection: unused, inspection: unused, accept: unused, reconcile: unused, operation: unused, operations: unused, update: unused, latest: async () => inventory, resourceIds: async (uids: readonly string[]) => { for (const uid of uids) if (!ids.has(uid)) ids.set(uid, newResourceId()); return ids; } };
  const summary = () => {
    const time = new Date(now).toISOString(), counter = String(BigInt(now) * 1_000_000n), stats = { cpu: { time, usageCoreNanoSeconds: counter }, memory: { time, workingSetBytes: 4096, usageBytes: 8192, availableBytes: 16_384 }, network: { time, name: 'eth0', rxBytes: String(now * 10), txBytes: String(now * 5), rxErrors: 0, txErrors: 0, interfaces: [{ name: 'eth0', rxBytes: String(now * 10), txBytes: String(now * 5), rxErrors: 0, txErrors: 0 }] } };
    return { node: { ...stats, nodeName: 'node-a', startTime: '2026-09-21T00:00:00Z', fs: { time, usedBytes: 10_000, availableBytes: 90_000, capacityBytes: 100_000, inodes: 100, inodesUsed: 5 }, runtime: { imageFs: { time, usedBytes: 5000 }, containerFs: { time, usedBytes: 5000 } } }, pods: topology.pods.filter((p) => p.metadata.name !== 'pending').map((p) => ({ ...stats, podRef: { uid: p.metadata.uid, name: p.metadata.name, namespace: p.metadata.namespace }, startTime: '2026-09-21T09:59:00Z', 'ephemeral-storage': { time, usedBytes: 1024 }, containers: [{ ...stats, name: 'app', startTime: '2026-09-21T09:59:00Z', rootfs: { time, usedBytes: 512 }, logs: { time, usedBytes: 512 } }] })) };
  };
  const deps: MetricsDeps = {
    clock: { now: () => new Date(now) }, options: { enabled: true, exporterToken: 'export-token', prometheusUrl: 'http://prometheus', prometheusToken: 'query-token', probeToken: 'probe-token', probeRoot: '/local', probePort: 8095 }, inventory: inventoryRepository,
    reader: { topology: async () => structuredClone(topology), sample: async () => ({ nodeUid: node.metadata.uid, summary: summary(), cadvisor: `container_fs_reads_bytes_total{device="/dev/vda",id="/"} ${now}\ncontainer_fs_writes_bytes_total{device="/dev/vda",id="/"} ${now * 2}\ncontainer_fs_reads_total{device="/dev/vda",id="/"} ${now}\ncontainer_fs_writes_total{device="/dev/vda",id="/"} ${now}`, errors: [] }) },
    repository: { schedule: async () => undefined, claim: async () => true, latest: async () => observation, observation: async (id) => observation?.id === id ? observation : undefined, save: async (value) => { observation = value; identities = value.identities; return true; }, storage: async () => storage, saveStorage: async (value) => { storage = value; return true; }, finish: async () => undefined, identities: async () => identities },
  };
  return { deps, topology, node, pod, pending, completed, outside, probe, pvc, volume, inventory, summary, advance: (ms = 15_000) => { now += ms; }, observation: () => observation!, storage: () => storage };
}
export const metricsTicket = { requestId: 'request-1', fence: 1 };
