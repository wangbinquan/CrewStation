import type { ClusterResource, ClusterSource, ClusterCapacity, ClusterHistoryResource, ClusterMetric, ClusterMetricName, ClusterNode, ClusterUsage } from '@crewstation/contracts';

export interface ResourceObject {
  apiVersion: string; kind: string;
  metadata: { name: string; namespace?: string; uid?: string; resourceVersion?: string; generation?: number; creationTimestamp?: string; deletionTimestamp?: string; labels?: Record<string, string>; annotations?: Record<string, string>; ownerReferences?: Array<{ apiVersion: string; kind: string; name: string; uid: string; controller?: boolean }> };
  [key: string]: unknown;
}
export interface ProjectFact { projectId: string; name: string; slug: string; namespace: string; kind: string; state: string; serviceId?: string; serviceName?: string }
export interface TaskFact { taskId: string; projectId: string; namespace: string; podName: string; podUid?: string; pvcName: string; pvcUid?: string; kind: string; state: string; purpose?: string; parentTaskId?: string; agentId?: string; terminalId?: string; profile: string; profileRevision?: number; profileTestId?: string; revision: string; volumeMode: string }
export interface ReleaseFact { serviceId: string; namespace: string; serviceName: string; physical: 'blue' | 'green'; role: 'prod' | 'preview'; releaseId?: string; state: string; manifestReplicas?: number; overrideReplicas?: number; maxReplicas?: number; revision: string }
export interface ProtectedReference { namespace: string; kind: string; name: string; reason: string }
export interface InventoryFacts { projects: ProjectFact[]; tasks: TaskFact[]; releases: ReleaseFact[]; retained: ProtectedReference[]; complete: boolean; reason?: string }
export interface SystemComponent { kind: string; name: string; component: string; purpose: 'platform-service' | 'platform-infrastructure'; restart: boolean; minReplicas?: number; maxReplicas?: number; impact: string[] }
export interface InventorySnapshot { id: string; startedAt: string; finishedAt: string; sources: ClusterSource[]; resources: ClusterResource[]; facts: InventoryFacts }
export const workloadKinds = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'ReplicaSet', 'ReplicationController']);
export const networkKinds = new Set(['Service', 'Ingress', 'IngressRoute', 'Middleware', 'NetworkPolicy']);
export const collectedKinds = [...workloadKinds, 'Pod', ...networkKinds, 'PersistentVolumeClaim', 'PersistentVolume', 'ConfigMap', 'Secret', 'ServiceAccount', 'ResourceQuota', 'HorizontalPodAutoscaler', 'Namespace'];
export const objectRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const objectArray = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(objectRecord) : [];
export const stringRecord = (value: unknown): Record<string, string> => Object.fromEntries(Object.entries(objectRecord(value)).filter((e): e is [string, string] => typeof e[1] === 'string'));
export const resourceKey = (r: Pick<ResourceObject, 'kind' | 'metadata'>): string => `${r.metadata.namespace ?? ''}/${r.kind}/${r.metadata.name}`;

export interface MetricsTopology { nodes: ResourceObject[]; pods: ResourceObject[]; pvcs: ResourceObject[]; volumes: ResourceObject[] }

export interface CounterSample { value: string; at: string; instance: string }
export interface StorageTarget { resourceId: string; uid: string; volumeUid: string; node: string; address?: string; rootId: string; relativePath: string }
export interface StorageResult { uid: string; volumeUid: string; metric: ClusterMetric }
export interface MetricsObservation { id: string; at: string; inventorySnapshotId: string; capacity: ClusterCapacity; nodes: ClusterNode[]; usages: ClusterUsage[]; counters: Record<string, CounterSample>; storageTargets: StorageTarget[]; identities: ClusterHistoryResource[]; identitiesComplete: boolean }
export const metricUnits: Record<ClusterMetricName, ClusterMetric['unit']> = { cpu: 'cores', memory: 'bytes', memoryUsage: 'bytes', memoryAvailable: 'bytes', ephemeralStorage: 'bytes', fsCapacity: 'bytes', fsUsed: 'bytes', fsAvailable: 'bytes', fsInodes: 'count', fsInodesUsed: 'count', imageFsUsed: 'bytes', containerFsUsed: 'bytes', networkRx: 'bytes/s', networkTx: 'bytes/s', networkRxErrors: 'ops/s', networkTxErrors: 'ops/s', diskRead: 'bytes/s', diskWrite: 'bytes/s', diskReadOps: 'ops/s', diskWriteOps: 'ops/s', volumeUsed: 'bytes', cpuRequested: 'cores', memoryRequested: 'bytes', ephemeralRequested: 'bytes', cpuCapacity: 'cores', memoryCapacity: 'bytes', ephemeralCapacity: 'bytes', cpuAllocatable: 'cores', memoryAllocatable: 'bytes', ephemeralAllocatable: 'bytes', storageRequested: 'bytes', storageCapacity: 'bytes' };
