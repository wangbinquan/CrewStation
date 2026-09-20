import type { ClusterInspection, ClusterOperation, ClusterOperationQuery } from '@crewstation/contracts';
import type { InventorySnapshot } from '../domain/inventory';
export interface SavedInspection { actorId: string; inspection: ClusterInspection }
export interface ClusterRepository {
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
