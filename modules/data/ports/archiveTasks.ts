import type { AcceptedArchiveFinalization, AcceptedArchiveRevision, ProjectId, ServiceId, TaskId } from '@crewstation/contracts';

/** Business owns task identity. A signed service identity cannot claim an arbitrary task UUID. */
export interface ArchiveTaskDirectory {
  read(serviceId: ServiceId, taskId: TaskId): Promise<{ projectId: ProjectId; completionPolicy: 'legacy' | 'archive-and-delete' } | undefined>;
  accepted(id: string): Promise<AcceptedArchiveFinalization | undefined>;
  revision?(id: string): Promise<AcceptedArchiveRevision | undefined>;
}
