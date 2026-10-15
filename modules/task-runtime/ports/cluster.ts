import type { StartupObservation } from '../domain/podStartup';
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
  /** 工作目录的卷：任务用自己的 PVC（默认）；档位测试用 Pod 内的临时目录，Pod 结束即清理（RFC-006 §5.2）。 */
  workVolume?: 'pvc' | 'emptyDir';
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
export interface PodPhaseReading { phase: PodPhase; uid?: string; message?: string; ip?: string; imageId?: string; waitingReason?: string }

/** 任务容器与卷的集群操作；实现在 adapters/k8s。 */
export interface TaskCluster {
  ensureVolume(env: TaskEnvironment, size: string): Promise<void>;
  createPod(spec: TaskPodSpec): Promise<string | void>;
  /** waitingReason：主容器的等待原因（ErrImagePull、CreateContainerError 等），档位测试据此区分镜像与 Runner 的失败。 */
  podPhase(env: TaskEnvironment): Promise<PodPhaseReading>;
  /** RFC-022：一次读 Pod 同时给出对账用的 phase 与启动观测；events 为 true 时再按 Pod UID 读它的 Events（拉镜像的细节）。Pod 不在时没有观测。 */
  observeStartup(env: TaskEnvironment, options: { events: boolean }): Promise<{ pod: PodPhaseReading; observation?: StartupObservation }>;
  /** 一个容器日志的最后若干行；判定失败时留证用，读不到就抛错由调用方忽略。 */
  tailLog(env: TaskEnvironment, container: string, lines: number): Promise<string>;
  deletePod(env: TaskEnvironment): Promise<void>;
  deleteVolume(env: TaskEnvironment): Promise<void>;
}
