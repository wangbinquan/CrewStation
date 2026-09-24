import type { ResourceChild } from '@crewstation/contracts';

/** 观测到的受管对象：Kubernetes 对象里调和器用得到的部分（领域层不依赖 k8s 包）。 */
export interface ObservedObject {
  readonly kind: string;
  readonly metadata: {
    readonly name: string;
    readonly namespace?: string;
    readonly uid?: string;
    readonly generation?: number;
    readonly labels?: Readonly<Record<string, string>>;
    readonly annotations?: Readonly<Record<string, string>>;
    readonly deletionTimestamp?: string;
    readonly creationTimestamp?: string;
    readonly ownerReferences?: readonly { readonly kind: string; readonly name: string; readonly controller?: boolean }[];
  };
  readonly spec?: unknown;
  readonly status?: unknown;
}

/** 资源中心写在子对象上的归属标签（设计 §6.2）；第一期还没有对象带它，收编（第六期）后都带上。 */
export const RESOURCE_ID_LABEL = 'crewstation.io/resource-id';
/** 调和器照期望渲染对象时写上的期望版本（记录的 generation，服务槽的 Deployment，T8）；观测照抄成子对象的 appliedGeneration。 */
export const RESOURCE_GENERATION_ANNOTATION = 'crewstation.io/resource-generation';

/** 对象上写着的期望版本；没有或不是非负整数就是 undefined（release 自己部署的旧形状没有它）。 */
export function appliedGenerationOf(obj: ObservedObject): number | undefined {
  const raw = obj.metadata.annotations?.[RESOURCE_GENERATION_ANNOTATION];
  const value = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(value) ? value : undefined;
}

/** 资源中心据观测得出的条件（只由资源中心写的那一类）。 */
export interface ObservedCondition {
  readonly type: string;
  readonly status: 'true' | 'false' | 'unknown';
  readonly reason?: string;
  readonly message?: string;
}

interface ContainerStatus {
  readonly ready?: boolean;
  readonly restartCount?: number;
  readonly lastState?: { readonly terminated?: { readonly finishedAt?: string } };
  readonly state?: { readonly waiting?: { readonly reason?: string; readonly message?: string }; readonly terminated?: { readonly reason?: string; readonly exitCode?: number } };
}

interface PodStatus {
  readonly phase?: string;
  readonly reason?: string;
  readonly message?: string;
  readonly conditions?: readonly { readonly type: string; readonly status: string; readonly reason?: string; readonly message?: string }[];
  readonly containerStatuses?: readonly ContainerStatus[];
  readonly initContainerStatuses?: readonly ContainerStatus[];
}

const MAX_REASON = 500;
const clip = (text: string): string => (text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text);

/** Pod 为什么还没好：调度失败、容器在等（拉镜像、崩溃重启）、已终止的原因；都没有就没有原因。 */
function podReason(status: PodStatus, deleting: boolean): string | undefined {
  if (deleting) return 'Terminating';
  const unschedulable = status.conditions?.find((c) => c.type === 'PodScheduled' && c.status === 'False');
  if (unschedulable) return clip(unschedulable.message ?? unschedulable.reason ?? 'Unschedulable');
  for (const container of [...(status.initContainerStatuses ?? []), ...(status.containerStatuses ?? [])]) {
    const waiting = container.state?.waiting;
    if (waiting?.reason && waiting.reason !== 'PodInitializing' && waiting.reason !== 'ContainerCreating') return clip(waiting.message ? `${waiting.reason}: ${waiting.message}` : waiting.reason);
    const terminated = container.state?.terminated;
    if (terminated?.reason && terminated.reason !== 'Completed' && status.phase === 'Failed') return clip(terminated.reason);
  }
  return status.reason ? clip(status.message ? `${status.reason}: ${status.message}` : status.reason) : undefined;
}

/** Pod → 子对象观测：阶段照抄 Kubernetes；删除中的一律不算就绪。 */
export function podChild(pod: ObservedObject, observedAt: string): ResourceChild {
  const status = (pod.status ?? {}) as PodStatus;
  const deleting = Boolean(pod.metadata.deletionTimestamp);
  const ready = !deleting && status.phase === 'Running' && status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True') === true;
  const restarts = (status.containerStatuses ?? []).reduce((sum, container) => sum + (container.restartCount ?? 0), 0);
  const reason = podReason(status, deleting);
  const node = (pod.spec as { nodeName?: string } | undefined)?.nodeName;
  return {
    kind: 'Pod', ...(pod.metadata.namespace ? { namespace: pod.metadata.namespace } : {}), name: pod.metadata.name, ...(pod.metadata.uid ? { uid: pod.metadata.uid } : {}),
    phase: status.phase ?? 'Pending', ready, ...(reason ? { reason } : {}), ...(node ? { node } : {}), restarts, observedAt,
  };
}

/** 容器在崩溃重启循环里（设计 §4.3：健康 crash-looping → 条件 CrashLooping）。 */
export function podConditions(pod: ObservedObject): ObservedCondition[] {
  const status = (pod.status ?? {}) as PodStatus;
  const looping = (status.containerStatuses ?? []).find((container) => container.state?.waiting?.reason === 'CrashLoopBackOff');
  return [looping
    ? { type: 'CrashLooping', status: 'true', reason: 'CrashLoopBackOff', message: clip(looping.state?.waiting?.message ?? '容器反复退出后正在退避重启') }
    : { type: 'CrashLooping', status: 'false' }];
}

/** PVC → 子对象观测：Bound 即就绪。 */
export function pvcChild(pvc: ObservedObject, observedAt: string): ResourceChild {
  const phase = ((pvc.status ?? {}) as { phase?: string }).phase ?? 'Pending';
  const deleting = Boolean(pvc.metadata.deletionTimestamp);
  return {
    kind: 'PersistentVolumeClaim', ...(pvc.metadata.namespace ? { namespace: pvc.metadata.namespace } : {}), name: pvc.metadata.name, ...(pvc.metadata.uid ? { uid: pvc.metadata.uid } : {}),
    phase, ready: !deleting && phase === 'Bound', ...(deleting ? { reason: 'Terminating' } : {}), observedAt,
  };
}

interface DeploymentStatus {
  readonly observedGeneration?: number;
  readonly replicas?: number;
  readonly updatedReplicas?: number;
  readonly readyReplicas?: number;
  readonly availableReplicas?: number;
  readonly conditions?: readonly { readonly type: string; readonly status: string; readonly reason?: string; readonly message?: string }[];
}

/**
 * Deployment → 子对象观测（服务槽，第三期）：副本都更新到新版本、都就绪、控制器已看过最新期望，才是 Available；
 * 推进超时（Progressing=False）是 Stalled；期望副本为 0 是 ScaledDown；新版本已铺完（NewReplicaSetAvailable）而副本又没全就绪
 * （崩溃重启、就绪探针失败）是 Unready；其余（还在铺新版本）Progressing。原因写就绪副本数。资源中心建的槽（T8）另带渲染它的期望版本：
 * 期望刚改、调和器还没应用时，旧版本的「都就绪」不能当成新期望的。
 */
export function deploymentChild(deployment: ObservedObject, observedAt: string): ResourceChild {
  const status = (deployment.status ?? {}) as DeploymentStatus;
  const desired = (deployment.spec as { replicas?: number } | undefined)?.replicas ?? 1, ready = status.readyReplicas ?? 0;
  const generation = deployment.metadata.generation ?? 0;
  const deleting = Boolean(deployment.metadata.deletionTimestamp);
  const progressing = status.conditions?.find((entry) => entry.type === 'Progressing');
  const stalled = progressing?.status === 'False' ? progressing : undefined, rolledOut = progressing?.status === 'True' && progressing.reason === 'NewReplicaSetAvailable';
  const current = (status.observedGeneration ?? 0) >= generation && (status.updatedReplicas ?? 0) === desired && (status.replicas ?? 0) === desired;
  const phase = deleting ? 'Terminating' : desired === 0 ? 'ScaledDown' : current && ready === desired ? 'Available' : stalled ? 'Stalled' : current && rolledOut ? 'Unready' : 'Progressing';
  const reason = deleting ? 'Terminating' : stalled && phase === 'Stalled' ? clip(stalled.message ?? stalled.reason ?? 'ProgressDeadlineExceeded') : `副本 ${ready}／${desired} 就绪`;
  const applied = appliedGenerationOf(deployment);
  return {
    kind: 'Deployment', ...(deployment.metadata.namespace ? { namespace: deployment.metadata.namespace } : {}), name: deployment.metadata.name, ...(deployment.metadata.uid ? { uid: deployment.metadata.uid } : {}),
    phase, ready: phase === 'Available', reason, replicas: desired, readyReplicas: ready, ...(applied !== undefined ? { appliedGeneration: applied } : {}), observedAt,
  };
}

/** 控制一个 Pod 的上级对象：服务槽的 Deployment，或构建、迁移的 Job。 */
export interface PodController { readonly kind: 'Deployment' | 'Job'; readonly namespace?: string; readonly name: string }

/**
 * Pod 的控制者：Job 管的就是那个 Job；ReplicaSet 管的属于哪个 Deployment——ReplicaSet 的名字是 Deployment 名加 `-<pod-template-hash>`
 * （Kubernetes 给 Deployment 建 ReplicaSet 的命名规则）。裸 Pod 与认不出的返回 undefined。
 */
export function controllerOf(pod: ObservedObject): PodController | undefined {
  const owner = pod.metadata.ownerReferences?.find((entry) => entry.controller);
  const namespace = pod.metadata.namespace ? { namespace: pod.metadata.namespace } : {};
  if (owner?.kind === 'Job') return { kind: 'Job', ...namespace, name: owner.name };
  const hash = pod.metadata.labels?.['pod-template-hash'];
  if (owner?.kind !== 'ReplicaSet' || !hash || !owner.name.endsWith(`-${hash}`) || owner.name.length <= hash.length + 1) return undefined;
  return { kind: 'Deployment', ...namespace, name: owner.name.slice(0, -(hash.length + 1)) };
}

interface JobStatus {
  readonly active?: number;
  readonly succeeded?: number;
  readonly failed?: number;
  readonly conditions?: readonly { readonly type: string; readonly status: string; readonly reason?: string; readonly message?: string }[];
}

const jobFinish = (status: JobStatus) => ({
  complete: status.conditions?.find((entry) => entry.type === 'Complete' && entry.status === 'True'),
  failed: status.conditions?.find((entry) => entry.type === 'Failed' && entry.status === 'True'),
});

/** Job → 子对象观测（构建、迁移，第三期）：Complete、Failed、Active（有 Pod 在跑）、Pending（建了还没跑起来）；失败的原因照 Job 的条件。 */
export function jobChild(job: ObservedObject, observedAt: string): ResourceChild {
  const status = (job.status ?? {}) as JobStatus, { complete, failed } = jobFinish(status);
  const deleting = Boolean(job.metadata.deletionTimestamp);
  const phase = deleting ? 'Terminating' : complete ? 'Complete' : failed ? 'Failed' : (status.active ?? 0) > 0 ? 'Active' : 'Pending';
  const reason = failed ? clip(failed.message ?? failed.reason ?? 'Job 失败') : deleting ? 'Terminating' : undefined;
  return {
    kind: 'Job', ...(job.metadata.namespace ? { namespace: job.metadata.namespace } : {}), name: job.metadata.name, ...(job.metadata.uid ? { uid: job.metadata.uid } : {}),
    phase, ready: phase === 'Complete', ...(reason ? { reason } : {}), observedAt,
  };
}

/** Job 结束了没有（只归资源中心的条件 Finished）：成功或失败都记下，Job 之后被 TTL 删掉也不改（台账留下结果）。 */
export function jobConditions(job: ObservedObject): ObservedCondition[] {
  const { complete, failed } = jobFinish((job.status ?? {}) as JobStatus);
  if (complete) return [{ type: 'Finished', status: 'true', reason: 'succeeded', message: '已完成' }];
  if (failed) return [{ type: 'Finished', status: 'true', reason: 'failed', message: clip(failed.message ?? failed.reason ?? 'Job 失败') }];
  return [{ type: 'Finished', status: 'false' }];
}

/** 崩溃重启的判定窗口与次数（G22，与旧的健康判定一致）。 */
export const CRASH_LOOP_WINDOW_MS = 600_000;
const CRASH_LOOP_RESTARTS = 3;

/**
 * 一个 Deployment 名下的 Pod 是否在崩溃重启（G22）：各容器的重启数之和至少 3 次，且最近一次退出在 10 分钟内。
 * 成立时给出何时该复核（最近一次退出满 10 分钟的时刻）：之后不再重启，条件就撤掉。
 */
export function crashLoopingOf(pods: readonly ObservedObject[], now: Date): { readonly condition: ObservedCondition; readonly recheckAfterMs?: number } {
  let restarts = 0, lastExit: number | undefined;
  for (const pod of pods) {
    for (const container of ((pod.status ?? {}) as PodStatus).containerStatuses ?? []) {
      restarts += container.restartCount ?? 0;
      const finished = container.lastState?.terminated?.finishedAt ? Date.parse(container.lastState.terminated.finishedAt) : Number.NaN;
      if (!Number.isNaN(finished)) lastExit = Math.max(lastExit ?? finished, finished);
    }
  }
  const age = lastExit === undefined ? undefined : now.getTime() - lastExit;
  if (restarts < CRASH_LOOP_RESTARTS || age === undefined || age >= CRASH_LOOP_WINDOW_MS) return { condition: { type: 'CrashLooping', status: 'false' } };
  return {
    condition: { type: 'CrashLooping', status: 'true', reason: 'restarting', message: `容器反复重启：累计重启 ${restarts} 次，10 分钟内仍有重启` },
    recheckAfterMs: CRASH_LOOP_WINDOW_MS - Math.max(0, age),
  };
}

/**
 * Pod、PVC 以外的子对象（Runner Secret、预览 Service 与路由）：在即就绪；删除中的记 Terminating、不算就绪。
 * 带上 `generation`：对象被人改了 spec，观测就变了，调和器随即按期望核对（路由由调和器应用，第三期后半）。
 */
export function presentChild(obj: ObservedObject, observedAt: string): ResourceChild {
  const deleting = Boolean(obj.metadata.deletionTimestamp);
  return {
    kind: obj.kind, ...(obj.metadata.namespace ? { namespace: obj.metadata.namespace } : {}), name: obj.metadata.name, ...(obj.metadata.uid ? { uid: obj.metadata.uid } : {}),
    phase: deleting ? 'Terminating' : 'Present', ready: !deleting, ...(obj.metadata.generation !== undefined ? { generation: obj.metadata.generation } : {}), observedAt,
  };
}

/** 对象消失时的观测：只留身份，阶段记 absent。 */
export function goneChild(obj: ObservedObject): ResourceChild {
  return { kind: obj.kind, ...(obj.metadata.namespace ? { namespace: obj.metadata.namespace } : {}), name: obj.metadata.name, ...(obj.metadata.uid ? { uid: obj.metadata.uid } : {}), phase: 'absent', ready: false };
}
