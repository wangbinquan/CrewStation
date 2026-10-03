import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import type { ProvisioningCallback, ProvisioningCallbackProcess, ProvisioningContainerProcess, ProvisioningPodProcess, ProvisioningWorkKind } from '../domain/projectWork';

export interface ProvisioningCallbackProcesses {
  protectCurrent(): Promise<ProvisioningCallbackProcess>;
  sweep(accept: { stopped(process: ProvisioningContainerProcess, digest: string): Promise<void>;
    podStopped(process: ProvisioningPodProcess, digest: string): Promise<void>; releasable(podUid: string): Promise<boolean> }): Promise<void>;
}
export interface ProvisioningProjectWork {
  run<T>(projectId: ProjectId, serviceId: string, kind: ProvisioningWorkKind, inputDigest: string, work: () => Promise<T>): Promise<T>;
  checkCurrent(projectId: ProjectId): Promise<void>;
  history(projectId: ProjectId): Promise<readonly ProvisioningCallback[]>;
  /** Admission closure is not a successful deletion owner phase or a physical reclamation proof. */
  close(context: ProjectDeletionContext): Promise<{ readonly pending: readonly string[] }>;
  observe(): Promise<void>;
}
