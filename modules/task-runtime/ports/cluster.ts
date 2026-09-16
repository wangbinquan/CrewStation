import type { TaskEnvironment } from '../domain/taskEnvironment';

/** 开发会话的源码检出：init 容器按分支克隆进工作卷，凭据只进 init 容器。 */
export interface TaskSourceCheckout {
  repoUrl: string;
  branch: string;
  /** 只读的会话级 Git 令牌所在 Secret，键为 `token`。 */
  credentialSecretName: string;
}

export interface TaskPodSpec {
  env: TaskEnvironment;
  image: string;
  envVars: Record<string, string>;
  /** 重建时持久化于专用 Secret，允许创建响应丢失后复用同一份环境。 */
  envSecretName?: string;
  resources: { cpu: string; memory: string; storage: string };
  /** 模型凭据等只给 Agent 进程的变量文件所在 Secret；不存在则不挂。 */
  agentEnvSecretName?: string;
  source?: TaskSourceCheckout;
  /** 共享 RWO 工作卷的执行容器与恢复容器由调度器安排在原节点。 */
  nodeName?: string;
  /** 开发预览的用户域主机与所需中间件；不给则不建路由。 */
  previewRoute?: { host: string; userAuthMiddleware: string; dropIdentityHeadersMiddleware: string; systemNamespace: string };
}

export interface NativeExecutionCluster {
  inspectWorkspace(parent: TaskEnvironment): Promise<{ podUid: string; pvcUid: string; nodeName: string }>;
  prepare(env: TaskEnvironment, values: () => Promise<Record<string, string>>): Promise<{ podUid: string; secretUid: string; token: string }>;
  cleanup(env: TaskEnvironment): Promise<void>;
}

export type PodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown' | 'Missing';

/** 任务容器与卷的集群操作；实现在 adapters/k8s。 */
export interface TaskCluster {
  ensureVolume(env: TaskEnvironment, size: string): Promise<void>;
  createPod(spec: TaskPodSpec): Promise<void>;
  podPhase(env: TaskEnvironment): Promise<{ phase: PodPhase; message?: string; ip?: string; imageId?: string }>;
  deletePod(env: TaskEnvironment): Promise<void>;
  deleteVolume(env: TaskEnvironment): Promise<void>;
}
