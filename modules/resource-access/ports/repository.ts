import type { ProjectId, ResourceCatalogPolicy, ResourceRequestQuery, ResourceType, SaveResourceCatalogPolicy } from '@crewstation/contracts';
import type { ResourceChange } from '../domain/change';

export interface ResourceAccessRepository {
  get(id: string): Promise<ResourceChange | undefined>;
  byKey(projectId: ProjectId, actorId: string, key: string): Promise<ResourceChange | undefined>;
  accept(change: ResourceChange): Promise<ResourceChange>;
  list(projectId: ProjectId, query: ResourceRequestQuery): Promise<{ items: ResourceChange[]; nextCursor: string | null }>;
  /** CAS 与恢复作业入队在同一事务中。 */
  save(change: ResourceChange, expectedVersion: number, enqueue?: boolean): Promise<boolean>;
  policies(): Promise<ResourceCatalogPolicy[]>;
  policy(type: ResourceType, resourceId: string): Promise<ResourceCatalogPolicy>;
  savePolicy(type: ResourceType, resourceId: string, input: SaveResourceCatalogPolicy, actorId: string, now: string): Promise<ResourceCatalogPolicy>;
}
