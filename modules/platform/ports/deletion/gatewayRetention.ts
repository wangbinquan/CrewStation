import type { ProjectDeletionCurrentAssets, ProjectId, ServiceId, TaskId } from '@crewstation/contracts';

/** Minimum public current witnesses; original private task rows and credentials stay with their owner. */
export interface GatewayRetentionTasks {
  getEnvironment(id: TaskId): Promise<{ id: TaskId; projectId: ProjectId; serviceId: string; kind: string; state: string; podName: string } | undefined>;
  listClusterTasks(): Promise<{ taskId: string; projectId: string; namespace: string; podName: string; podUid?: string; pvcName: string; pvcUid?: string; kind: string; state: string; profile: string; volumeMode: string }[]>;
  originalInfrastructureOwnership(kind: 'task', key: string): Promise<{ complete: true; id: string; scope: 'project' | 'platform'; projectIds: readonly ProjectId[]; revision: string } | undefined>;
}
export interface GatewayRetentionSources {
  project: { resolveServiceById(id: ServiceId): Promise<{ projectId: ProjectId; serviceId: ServiceId; namespace: string; identity: string; state: string } | undefined> };
  tasks(): GatewayRetentionTasks | undefined;
}
export interface GatewayDevelopmentBaseline {
  taskId: string; projectId: ProjectId; serviceId: ServiceId; namespace: string; podName: string; podUid: string;
  kind: 'dev-session'; state: 'running'; originalAbsent: true; taskDigest: string;
  volumes: readonly { namespace: string; name: string; uid: string; pvName: string; pvUid: string; digest: string }[];
  assets: Awaited<ReturnType<ProjectDeletionCurrentAssets['inspect']>>;
}
