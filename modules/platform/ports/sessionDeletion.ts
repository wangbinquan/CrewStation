import type { ProjectDeletionContext, ProjectId, TaskId } from '@crewstation/contracts';
import type { OriginalInfrastructureOrigin } from './infrastructureOrigins';

export interface SessionOriginalTasks {
  originalInfrastructureOwnership(kind: 'task', key: string, representation?: 'current' | 'legacy'): Promise<OriginalInfrastructureOrigin | undefined>;
  originalProjectTaskIds(projectId: ProjectId, after: string | null): Promise<readonly TaskId[]>;
}
export interface SessionProjectAdmission {
  assertProjectAvailable(projectId: ProjectId): Promise<void>;
  assertProjectDeletionGrant(context: ProjectDeletionContext): Promise<void>;
}
interface SessionProcess { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly nodeName: string;
  readonly pid: number; readonly pidNamespace: string; readonly bootId: string; readonly startTicks: string }
export interface SessionProcessObservers {
  protectCurrentProcess(): Promise<SessionProcess>;
  sweep(accept: { stopped(process: Pick<SessionProcess, 'podUid' | 'containerId' | 'nodeUid' | 'nodeName'>, digest: string): Promise<void>;
    podStopped(process: Pick<SessionProcess, 'podUid' | 'nodeUid' | 'nodeName'>, digest: string): Promise<void>; releasable(podUid: string): Promise<boolean> }): Promise<void>;
}
