import type { ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import type { DeletionLease, DeletionOperationRecord, DeletionPlanRecord } from '../domain/deletion/records';
import type { Project } from '../domain/project';

export interface ProjectDeletions {
  lockProject(id: ProjectId): Promise<Project | undefined>;
  getPlan(id: string): Promise<DeletionPlanRecord | undefined>;
  insertPlan(plan: DeletionPlanRecord): Promise<void>;
  getOperation(id: string, lock?: boolean | 'available'): Promise<DeletionOperationRecord | undefined>;
  /** The executor belongs to this unit-of-work transaction; callers may only use public package operations. */
  withExecutor<T>(work: (executor: object) => Promise<T>): Promise<T>;
  findOperation(projectId: ProjectId): Promise<DeletionOperationRecord | undefined>;
  findRequest(requestKey: string): Promise<DeletionOperationRecord | undefined>;
  lockRequest(requestKey: string): Promise<void>;
  insertOperation(operation: DeletionOperationRecord): Promise<void>;
  saveOperation(operation: DeletionOperationRecord): Promise<void>;
  /** Atomically extend only a live original lease; never serialize or republish receipt bodies. */
  renewOperation(lease: DeletionLease, now: Date, until: Date): Promise<boolean>;
  markDeleting(id: ProjectId, at: Date): Promise<void>;
  lifecycleRevision(id: ProjectId): Promise<string>;
  listPending(now: Date, after?: string, limit?: number): Promise<string[]>;
  /** 只清理本 schema 的归属数据；根记录与计划必须留到最后的完整证明。 */
  inspectMetadata(id: ProjectId): Promise<ProjectDeletionInventory>;
  purgeMetadata(id: ProjectId, operationId: string): Promise<void>;
  metadataCount(id: ProjectId): Promise<number>;
  finish(id: ProjectId, operationId: string): Promise<void>;
}
