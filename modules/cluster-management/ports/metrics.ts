import type { ClusterHistoryResource } from '@crewstation/contracts';
import type { MetricsObservation, MetricsTopology, StorageResult } from '../domain/observations';

export type { MetricsTopology } from '../domain/observations';
export interface NodeSample { summary?: unknown; cadvisor?: string; nodeUid?: string; errors: string[] }
export interface MetricsReader { topology(signal: AbortSignal): Promise<MetricsTopology>; sample(node: string, signal: AbortSignal): Promise<NodeSample> }
export type CollectorKind = 'metrics' | 'storage';
export interface CollectorTicket { requestId: string; fence: number }
export interface MetricsRepository {
  schedule(kind: CollectorKind): Promise<void>;
  claim(kind: CollectorKind, ticket: CollectorTicket): Promise<boolean>;
  latest(): Promise<MetricsObservation | undefined>;
  observation(id: string): Promise<MetricsObservation | undefined>;
  save(value: MetricsObservation, ticket: CollectorTicket): Promise<boolean>;
  storage(): Promise<StorageResult[]>;
  saveStorage(values: StorageResult[], at: string, ticket: CollectorTicket): Promise<boolean>;
  finish(kind: CollectorKind, ticket: CollectorTicket): Promise<void>;
  identities(): Promise<ClusterHistoryResource[]>;
}
export interface MetricsOptions { enabled: boolean; exporterToken: string; prometheusUrl: string; prometheusToken: string; probeToken: string; probeRoot: string; probePort: number }
export interface PrometheusMatrix { metric: Record<string, string>; values: [number, string][] }
export interface HistoryReader { range(query: string, start: number, end: number, step: number, signal: AbortSignal): Promise<PrometheusMatrix[]> }

export const METRICS_JOB = 'cluster-management.metrics', STORAGE_JOB = 'cluster-management.storage';
