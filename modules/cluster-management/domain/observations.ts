import type { ClusterCapacity, ClusterHistoryResource, ClusterMetric, ClusterMetricName, ClusterNode, ClusterUsage } from '@crewstation/contracts';

import type { ResourceObject } from './inventory';
export interface MetricsTopology { nodes: ResourceObject[]; pods: ResourceObject[]; pvcs: ResourceObject[]; volumes: ResourceObject[] }

export interface CounterSample { value: string; at: string; instance: string }
export interface StorageTarget { resourceId: string; uid: string; volumeUid: string; node: string; address?: string; rootId: string; relativePath: string }
export interface StorageResult { uid: string; volumeUid: string; metric: ClusterMetric }
export interface MetricsObservation { id: string; at: string; inventorySnapshotId: string; capacity: ClusterCapacity; nodes: ClusterNode[]; usages: ClusterUsage[]; counters: Record<string, CounterSample>; storageTargets: StorageTarget[]; identities: ClusterHistoryResource[]; identitiesComplete: boolean }
export const metricUnits: Record<ClusterMetricName, ClusterMetric['unit']> = { cpu: 'cores', memory: 'bytes', memoryUsage: 'bytes', memoryAvailable: 'bytes', ephemeralStorage: 'bytes', fsCapacity: 'bytes', fsUsed: 'bytes', fsAvailable: 'bytes', fsInodes: 'count', fsInodesUsed: 'count', imageFsUsed: 'bytes', containerFsUsed: 'bytes', networkRx: 'bytes/s', networkTx: 'bytes/s', networkRxErrors: 'ops/s', networkTxErrors: 'ops/s', diskRead: 'bytes/s', diskWrite: 'bytes/s', diskReadOps: 'ops/s', diskWriteOps: 'ops/s', volumeUsed: 'bytes', cpuRequested: 'cores', memoryRequested: 'bytes', ephemeralRequested: 'bytes', cpuCapacity: 'cores', memoryCapacity: 'bytes', ephemeralCapacity: 'bytes', cpuAllocatable: 'cores', memoryAllocatable: 'bytes', ephemeralAllocatable: 'bytes', storageRequested: 'bytes', storageCapacity: 'bytes' };
