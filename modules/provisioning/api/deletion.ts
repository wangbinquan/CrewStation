import type { AcceptProjectDeletion, Actor, ProjectDeletionOperation, ProjectDeletionPlan, ProjectId } from '@crewstation/contracts';

export interface ProjectDeletionController {
  prepare(actor: Actor, projectId: ProjectId): Promise<ProjectDeletionPlan>;
  accept(actor: Actor, projectId: ProjectId, input: AcceptProjectDeletion): Promise<ProjectDeletionOperation>;
  read(actor: Actor, operationId: string): Promise<ProjectDeletionOperation>;
  retry(actor: Actor, operationId: string): Promise<ProjectDeletionOperation>;
  enqueue(operationId: string): Promise<void>;
  advance(operationId: string, heartbeat?: () => Promise<boolean>): Promise<void>;
  recover(): Promise<void>;
}
