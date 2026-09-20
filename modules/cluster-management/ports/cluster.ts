import type { ClusterEvents, ClusterLogs, ClusterLogsQuery, ClusterResource, ClusterInspectRequest, ClusterInspection, ClusterOperation, Actor } from '@crewstation/contracts';
import type { InventoryFacts, ResourceObject } from '../domain/inventory';
export interface ClusterReader {
  collect(kind: string, namespace: string | undefined, selector: string | undefined, signal: AbortSignal): Promise<{ objects: ResourceObject[]; resourceVersion: string }>;
  get(resource: ClusterResource): Promise<ResourceObject | undefined>;
  events(resource: ClusterResource): Promise<ClusterEvents>;
  logs(resource: ClusterResource, query: ClusterLogsQuery): Promise<ClusterLogs>;
  apply(resource: ClusterResource, request: ClusterInspectRequest, operationId: string): Promise<void>;
  hasApplied(resource: ClusterResource, request: ClusterInspectRequest, operationId: string): Promise<boolean>;
}
export interface ClusterMetadata { read(): Promise<InventoryFacts> }
export interface DomainOperations {
  inspect(actor: Actor, target: ClusterResource, request: ClusterInspectRequest): Promise<Pick<ClusterInspection, 'capability' | 'domain'>>;
  execute(actor: Actor, operation: ClusterOperation, inspection: ClusterInspection): Promise<{ operationId: string }>;
  observe(operation: ClusterOperation): Promise<{ done: boolean; failed?: boolean; reason: string }>;
}
