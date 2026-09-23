import type { ResourceChild } from '@crewstation/contracts';

/** 观测到的受管对象：Kubernetes 对象里调和器用得到的部分（领域层不依赖 k8s 包）。 */
export interface ObservedObject {
  readonly kind: string;
  readonly metadata: {
    readonly name: string;
    readonly namespace?: string;
    readonly uid?: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly deletionTimestamp?: string;
    readonly creationTimestamp?: string;
  };
  readonly spec?: unknown;
  readonly status?: unknown;
}

/** 资源中心写在子对象上的归属标签（设计 §6.2）；第一期还没有对象带它，收编（第六期）后都带上。 */
export const RESOURCE_ID_LABEL = 'crewstation.io/resource-id';

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

/** 对象消失时的观测：只留身份，阶段记 absent。 */
export function goneChild(obj: ObservedObject): ResourceChild {
  return { kind: obj.kind, ...(obj.metadata.namespace ? { namespace: obj.metadata.namespace } : {}), name: obj.metadata.name, ...(obj.metadata.uid ? { uid: obj.metadata.uid } : {}), phase: 'absent', ready: false };
}
