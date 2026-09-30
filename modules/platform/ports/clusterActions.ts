import type { Actor, ClusterInspectRequest, ClusterInspection, ClusterOperation, ClusterResource, DevSessionRebuildDto, DevSessionRebuildInspection, ProfileTestId, ProjectId, RebuildDevSessionRequest, TaskId, WorkspaceStatusDto } from '@crewstation/contracts';

type Inspect = (actor: Actor, target: ClusterResource, request: ClusterInspectRequest) => Promise<Record<string, unknown>>;
type Execute = (actor: Actor, op: ClusterOperation) => Promise<{ operationId: string }>;
type Observe = (op: ClusterOperation) => Promise<{ done: boolean; failed?: boolean; reason: string }>;
export interface ClusterActionPorts {
  tasks: {
    getEnvironment(id: TaskId): Promise<{ id: TaskId; projectId: ProjectId; volumeMode: string; state: string; connected: boolean; message?: string } | undefined>;
    inspectRebuild(id: ProjectId, admin: boolean): Promise<DevSessionRebuildInspection>;
    getRebuild(id: TaskId): Promise<DevSessionRebuildDto | undefined>; releaseEnvironment(id: TaskId, reason: 'profile-test'): Promise<unknown>;
  };
  dev: {
    inspectClusterNative(actor: Actor, id: TaskId): Promise<Record<string, unknown>>; inspectClusterAgent(actor: Actor, id: TaskId): Promise<Record<string, unknown>>;
    manageClusterNative(actor: Actor, id: TaskId, restart: boolean, operationId: string): Promise<{ operationId: string }>; manageClusterAgent(actor: Actor, id: TaskId, restart: boolean, operationId: string): Promise<{ operationId: string }>;
    workspaceStatus(actor: Actor, id: ProjectId): Promise<WorkspaceStatusDto>; releaseSession(actor: Actor, id: ProjectId, options: { force: boolean; expectedTaskId: TaskId }): Promise<unknown>; rebuildSession(actor: Actor, id: ProjectId, input: RebuildDevSessionRequest): Promise<unknown>;
  };
  business: { inspectClusterTask: Inspect; executeClusterTask: Execute; observeClusterTask: Observe };
  stopProfile(actor: Actor, id: ProfileTestId): Promise<void>;
  release: { inspectSlotOperation: (actor: Actor, target: ClusterResource, input: ClusterInspectRequest) => Promise<Pick<ClusterInspection, 'capability' | 'domain'>>; executeSlotOperation: (actor: Actor, op: ClusterOperation, inspection: ClusterInspection) => Promise<{ operationId: string }>; observeSlotOperation: Observe };
}
