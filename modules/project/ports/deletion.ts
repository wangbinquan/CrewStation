import type { ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import type { DeletionOperationRecord, DeletionPlanRecord } from '../domain/deletion/records';
import type { Project } from '../domain/project';

export interface ProjectDeletions {
  lockProject(id: ProjectId): Promise<Project | undefined>;
  getPlan(id: string): Promise<DeletionPlanRecord | undefined>;
  insertPlan(plan: DeletionPlanRecord): Promise<void>;
  getOperation(id: string, lock?: boolean): Promise<DeletionOperationRecord | undefined>;
  findOperation(projectId: ProjectId): Promise<DeletionOperationRecord | undefined>;
  findRequest(requestKey: string): Promise<DeletionOperationRecord | undefined>;
  lockRequest(requestKey: string): Promise<void>;
  insertOperation(operation: DeletionOperationRecord): Promise<void>;
  saveOperation(operation: DeletionOperationRecord): Promise<void>;
  markDeleting(id: ProjectId, at: Date): Promise<void>;
  lifecycleRevision(id: ProjectId): Promise<string>;
  listPending(now: Date, after?: string, limit?: number): Promise<string[]>;
  /** 只清理本 schema 的归属数据；根记录与计划必须留到最后的完整证明。 */
  inspectMetadata(id: ProjectId): Promise<ProjectDeletionInventory>;
  purgeMetadata(id: ProjectId, operationId: string): Promise<void>;
  metadataCount(id: ProjectId): Promise<number>;
  finish(id: ProjectId, operationId: string): Promise<void>;
}
