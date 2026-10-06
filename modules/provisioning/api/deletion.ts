import type { AcceptProjectDeletion, Actor, ProjectDeletionOperation, ProjectDeletionPlan, ProjectId } from '@crewstation/contracts';
import type { ConfirmProjectDeletionRepair, ProjectDeletionRepairItem, ProjectDeletionRepairList } from '@crewstation/contracts';

export interface ProjectDeletionController {
  readonly repairs?: {
    inspect(actor: Actor, id: ProjectId): Promise<ProjectDeletionRepairList>;
    confirm(actor: Actor, id: ProjectId, input: ConfirmProjectDeletionRepair): Promise<ProjectDeletionRepairItem>;
  };
  prepare(actor: Actor, projectId: ProjectId): Promise<ProjectDeletionPlan>;
  accept(actor: Actor, projectId: ProjectId, input: AcceptProjectDeletion): Promise<ProjectDeletionOperation>;
  read(actor: Actor, operationId: string): Promise<ProjectDeletionOperation>;
  find(actor: Actor, projectId: ProjectId): Promise<ProjectDeletionOperation | undefined>;
  retry(actor: Actor, operationId: string): Promise<ProjectDeletionOperation>;
  prepareReconfirmation(actor: Actor, operationId: string): Promise<ProjectDeletionPlan>;
  reconfirm(actor: Actor, operationId: string, input: AcceptProjectDeletion): Promise<ProjectDeletionOperation>;
  enqueue(operationId: string): Promise<void>;
  advance(operationId: string, heartbeat?: () => Promise<boolean>): Promise<void>;
  recover(): Promise<void>;
}
