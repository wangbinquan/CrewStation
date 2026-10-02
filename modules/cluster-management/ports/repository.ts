import type { ClusterInspection, ClusterOperation, ClusterOperationQuery, ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';
import type { InventorySnapshot } from '../domain/observations';
import type { ClusterProjectScope } from '../domain/projectDeletion';
export interface SavedInspection { actorId: string; inspection: ClusterInspection }
export interface ClusterRepository {
  resourceIds(uids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  latest(): Promise<InventorySnapshot | undefined>;
  snapshot(id: string): Promise<InventorySnapshot | undefined>;
  saveSnapshot(snapshot: InventorySnapshot): Promise<void>;
  requestRefresh(): Promise<string>;
  finishRefresh(id: string): Promise<void>;
  saveInspection(value: SavedInspection): Promise<void>;
  inspection(id: string): Promise<SavedInspection | undefined>;
  accept(operation: ClusterOperation, requestHash: string): Promise<ClusterOperation>;
  reconcile(id: string, now: Date): Promise<ClusterOperation>;
  operation(id: string): Promise<ClusterOperation | undefined>;
  operations(query: ClusterOperationQuery, actorId: string): Promise<ClusterOperation[]>;
  update(operation: ClusterOperation, fence: number): Promise<boolean>;
}
export interface ClusterCallbackProcess { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly nodeName: string }
export interface ClusterCallbackProcesses {
  protectCurrent(): Promise<ClusterCallbackProcess>;
  sweep(accept: { stopped(process: ClusterCallbackProcess, digest: string): Promise<void>; releasable(podUid: string): Promise<boolean> }): Promise<void>;
}
export interface ClusterProjectAdmission {
  withAdmission<T>(projectId: string, operationId: string, work: () => Promise<T>): Promise<T>;
  assertActive(): void;
  observe(): Promise<void>;
}
export interface ClusterDeletionStored {
  scope: ClusterProjectScope; verified: boolean; stopped: boolean; purged: boolean; proved: boolean; metadataPurged: boolean; cleanedCount: number;
  completed: { digest: string; count: number } | null;
}
export interface ClusterDeletionRepository {
  inspect(target: ProjectDeletionTarget): Promise<{ inventory: ProjectDeletionInventory; scope: ClusterProjectScope }>;
  seal(context: ProjectDeletionContext): Promise<boolean | 'waiting'>;
  load(context: ProjectDeletionContext): Promise<ClusterDeletionStored>;
  stop(context: ProjectDeletionContext): Promise<boolean>;
  record(context: ProjectDeletionContext): Promise<void>;
  purge(context: ProjectDeletionContext): Promise<number>;
  complete(context: ProjectDeletionContext, digest: string): Promise<void>;
}
