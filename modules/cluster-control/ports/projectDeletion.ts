import type { ProjectDeletionContext, ProjectDeletionOwner } from '@crewstation/contracts';

export interface ProjectClusterDeletion {
  inspect: ProjectDeletionOwner['inspect'];
  removeNamespace(context: ProjectDeletionContext, namespaceUid: string): Promise<boolean>;
}
