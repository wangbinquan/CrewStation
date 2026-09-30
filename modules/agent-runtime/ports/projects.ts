import type { Actor, ProjectDeletionContext, ProjectId } from '@crewstation/contracts';

/** 项目存在性和成员关系由 project 拥有，算力分配由 agent-runtime 拥有。 */
export interface ComputeProjects {
  assertProjectDeletionGrant?(context: ProjectDeletionContext): Promise<void>;
  assertProjectAvailable?(projectId: ProjectId): Promise<void>;
  authorize(actor: Actor, projectId: ProjectId, action: 'view'): Promise<unknown>;
  name(projectId: ProjectId): Promise<string | undefined>;
}
