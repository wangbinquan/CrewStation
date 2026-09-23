import type { K8sObject } from './resources';

/**
 * RFC-022：从一个 Pod 和它的 Events 读出启动过程——调度、每个 init／主容器的等待原因与起止时间、镜像拉取。
 * 只认 Kubernetes 的概念，不含任何平台语义；时间一律取 Kubernetes 自己记的（条件的 lastTransitionTime、容器状态、事件时间）。
 */
export interface PodStartupContainer {
  readonly name: string;
  readonly init: boolean;
  readonly image?: string;
  readonly waiting?: { readonly reason: string; readonly message?: string };
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly exitCode?: number;
  readonly terminatedReason?: string;
}

export interface PodImagePull {
  readonly container: string;
  readonly image?: string;
  /** Pulling 事件的时间。 */
  readonly startedAt?: string;
  /** Pulled 事件的时间。 */
  readonly endedAt?: string;
  /** 节点上已有镜像（Pulled 的 already present）。 */
  readonly cached: boolean;
  /** kubelet 报告的拉取用时原文，例如 2.345s。 */
  readonly took?: string;
  /** Failed／BackOff 事件的原文。 */
  readonly failure?: string;
}

export interface PodStartupObservation {
  readonly uid?: string;
  /** Pod 对象的创建时间（metadata.creationTimestamp）。 */
  readonly createdAt?: string;
  readonly phase: string;
  readonly node?: string;
  readonly scheduledAt?: string;
  readonly unschedulable?: { readonly reason?: string; readonly message?: string };
  /** 先 init 容器后主容器，各按 spec 里的顺序。 */
  readonly containers: readonly PodStartupContainer[];
  readonly pulls: readonly PodImagePull[];
}

interface ContainerState { waiting?: { reason?: string; message?: string }; running?: { startedAt?: string }; terminated?: { startedAt?: string; finishedAt?: string; exitCode?: number; reason?: string } }
interface ContainerStatus { name: string; image?: string; state?: ContainerState }
type PodLike = K8sObject & {
  spec?: { nodeName?: string; initContainers?: Array<{ name: string; image?: string }>; containers?: Array<{ name: string; image?: string }> };
  status?: { phase?: string; conditions?: Array<{ type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string }>; initContainerStatuses?: ContainerStatus[]; containerStatuses?: ContainerStatus[] };
};
export interface PodEventLike {
  readonly reason?: string;
  readonly message?: string;
  readonly eventTime?: string | null;
  readonly firstTimestamp?: string | null;
  readonly lastTimestamp?: string | null;
  readonly involvedObject?: { readonly fieldPath?: string };
}

const FIELD_PATH = /^spec\.(?:initContainers|containers)\{([^}]+)\}$/;
const PULLED = /^Successfully pulled image "([^"]+)" in (\S+?)(?:\s|$)/;
const PRESENT = /^Container image "([^"]+)" already present on machine/;
const PULLING = /^Pulling image "([^"]+)"/;

export function podStartup(pod: K8sObject, events: readonly PodEventLike[] = []): PodStartupObservation {
  const { spec, status, metadata } = pod as PodLike;
  const scheduled = status?.conditions?.find((condition) => condition.type === 'PodScheduled');
  const containers = [
    ...(spec?.initContainers ?? []).map((c) => containerOf(c, true, status?.initContainerStatuses)),
    ...(spec?.containers ?? []).map((c) => containerOf(c, false, status?.containerStatuses)),
  ];
  return {
    ...(metadata.uid ? { uid: metadata.uid } : {}), ...(metadata.creationTimestamp ? { createdAt: metadata.creationTimestamp } : {}), phase: status?.phase ?? 'Unknown',
    ...(spec?.nodeName ? { node: spec.nodeName } : {}),
    ...(scheduled?.status === 'True' && scheduled.lastTransitionTime ? { scheduledAt: scheduled.lastTransitionTime } : {}),
    ...(scheduled?.status === 'False' ? { unschedulable: { ...(scheduled.reason ? { reason: scheduled.reason } : {}), ...(scheduled.message ? { message: scheduled.message } : {}) } } : {}),
    containers, pulls: pullsOf(events, containers),
  };
}

function containerOf(spec: { name: string; image?: string }, init: boolean, statuses: readonly ContainerStatus[] | undefined): PodStartupContainer {
  const state = statuses?.find((s) => s.name === spec.name)?.state;
  const ended = state?.terminated;
  return {
    name: spec.name, init, ...(spec.image ? { image: spec.image } : {}),
    ...(state?.waiting?.reason ? { waiting: { reason: state.waiting.reason, ...(state.waiting.message ? { message: state.waiting.message } : {}) } } : {}),
    ...(state?.running?.startedAt ?? ended?.startedAt ? { startedAt: (state?.running?.startedAt ?? ended?.startedAt)! } : {}),
    ...(ended?.finishedAt ? { finishedAt: ended.finishedAt } : {}),
    ...(ended?.exitCode === undefined ? {} : { exitCode: ended.exitCode }), ...(ended?.reason ? { terminatedReason: ended.reason } : {}),
  };
}

/** 事件按 fieldPath 归到容器；同一容器多次拉取（退避重试）时合成一条：最早的 Pulling、最后的结果。 */
function pullsOf(events: readonly PodEventLike[], containers: readonly PodStartupContainer[]): PodImagePull[] {
  const byContainer = new Map<string, { image?: string; startedAt?: string; endedAt?: string; cached: boolean; took?: string; failure?: string }>();
  const sorted = [...events].sort((a, b) => (firstAt(a) ?? '').localeCompare(firstAt(b) ?? ''));
  for (const event of sorted) {
    const container = FIELD_PATH.exec(event.involvedObject?.fieldPath ?? '')?.[1];
    if (!container || !containers.some((c) => c.name === container)) continue;
    const pull = byContainer.get(container) ?? { cached: false };
    const message = event.message ?? '';
    if (event.reason === 'Pulling') { pull.startedAt ??= firstAt(event); pull.image ??= PULLING.exec(message)?.[1]; }
    else if (event.reason === 'Pulled') {
      const pulled = PULLED.exec(message), present = PRESENT.exec(message);
      pull.endedAt = lastAt(event); pull.cached = !!present; pull.image = pulled?.[1] ?? present?.[1] ?? pull.image; delete pull.failure;
      if (pulled?.[2]) pull.took = pulled[2];
    } else if ((event.reason === 'Failed' || event.reason === 'BackOff') && /image/i.test(message)) pull.failure = message;
    else continue;
    byContainer.set(container, pull);
  }
  return [...byContainer].map(([container, pull]) => ({ container, ...pull }));
}

const firstAt = (event: PodEventLike): string | undefined => event.firstTimestamp ?? event.eventTime ?? event.lastTimestamp ?? undefined;
const lastAt = (event: PodEventLike): string | undefined => event.lastTimestamp ?? event.eventTime ?? event.firstTimestamp ?? undefined;
