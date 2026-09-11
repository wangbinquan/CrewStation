import type { TaskEnvironment } from '../domain/taskEnvironment';

export interface TaskPodSpec {
  env: TaskEnvironment;
  image: string;
  envVars: Record<string, string>;
  resources: { cpu: string; memory: string; storage: string };
  /** 模型凭据等只给 Agent 进程的变量文件所在 Secret；不存在则不挂。 */
  agentEnvSecretName?: string;
}

export type PodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown' | 'Missing';

/** 任务容器与卷的集群操作；实现在 adapters/k8s。 */
export interface TaskCluster {
  ensureVolume(env: TaskEnvironment, size: string): Promise<void>;
  createPod(spec: TaskPodSpec): Promise<void>;
  podPhase(env: TaskEnvironment): Promise<{ phase: PodPhase; message?: string; ip?: string }>;
  deletePod(env: TaskEnvironment): Promise<void>;
  deleteVolume(env: TaskEnvironment): Promise<void>;
}
