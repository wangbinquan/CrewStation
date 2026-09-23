import type { TaskKind, Actor, LogEntryDto, ProjectId, ServiceId, SubtaskDto, TaskId } from '@crewstation/contracts';

export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: 'view'): Promise<unknown>;
}

export interface ServiceResolver {
  resolveServiceOfProject(projectId: ProjectId): Promise<{ serviceId: ServiceId; slug: string; name: string; namespace: string } | undefined>;
}

/** 由 release 提供：两个物理槽的角色，用于把 prod／preview 映射到 Deployment 名。 */
export interface SlotRoles {
  slotRoles(serviceId: ServiceId): Promise<{ prod: 'blue' | 'green'; preview: 'blue' | 'green' } | undefined>;
}

export interface WorkloadObservation {
  replicas: number;
  readyReplicas: number;
  restarts: number;
  lastRestartAgeSeconds?: number;
  lastTransitionAt: string;
}

/** 集群观测：Deployment 状态与 Pod 日志；实现在 adapters/k8s。 */
export interface ClusterObserver {
  observeDeployment(namespace: string, name: string): Promise<WorkloadObservation | undefined>;
  tailLogs(namespace: string, selector: string, options: { tailLines: number; sinceSeconds?: number }): Promise<LogEntryDto[]>;
}

/** 追溯来源：任务与子任务按 traceId 关联；Agent 会话由 session 事件提供。 */
export interface TraceSources {
  tasksByTrace(traceId: string): Promise<Array<{ taskId: TaskId; kind: TaskKind; createdAt: string }>>;
  subtasksOfTask(taskId: TaskId): Promise<SubtaskDto[]>;
  sessionEvents(taskId: TaskId): Promise<Array<{ seq: number; at: string; event: { kind: string; event?: { agentId?: string; sessionId?: string; type?: string; text?: string } } }>>;
}
