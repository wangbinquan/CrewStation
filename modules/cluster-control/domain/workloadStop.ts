import type { ContainerStopEvidence, WorkloadConsumer, WorkloadStopProof } from '@crewstation/contracts';
import { WORKLOAD_CONSUMER_ANNOTATION, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { ObservedObject } from './observation';

export type WorkloadStopObservation = { state: 'proved'; proof: WorkloadStopProof } | { state: 'blocked'; code: string };
export interface StopNodeEvidence { name: string; uid: string; ready: boolean; leaseFresh: boolean; kubeletVersion: string }
interface ContainerStatus {
  name: string; containerID?: string; restartCount?: number; started?: boolean;
  state?: { running?: unknown; waiting?: unknown; terminated?: { containerID?: string; exitCode?: number; reason?: string; finishedAt?: string } };
  lastState?: { running?: unknown; terminated?: unknown };
}
interface PodStatus {
  phase?: string; reason?: string;
  conditions?: Array<{ type: string; status: string }>;
  initContainerStatuses?: ContainerStatus[]; containerStatuses?: ContainerStatus[]; ephemeralContainerStatuses?: ContainerStatus[];
}
interface PodSpec { nodeName?: string; initContainers?: Array<{ name: string }>; containers?: Array<{ name: string }>; ephemeralContainers?: Array<{ name: string }> }
const blocked = (code: string): WorkloadStopObservation => ({ state: 'blocked', code });
function neverRan(status: ContainerStatus | undefined): boolean {
  return !status || (!status.containerID && !status.state?.running && !status.state?.terminated && !status.lastState?.running && !status.lastState?.terminated && (status.restartCount ?? 0) === 0 && status.started !== true);
}
function containersOf(spec: PodSpec, status: PodStatus, neverScheduled: boolean): ContainerStopEvidence[] | undefined {
  const groups = [['init', spec.initContainers ?? [], status.initContainerStatuses ?? []], ['container', spec.containers ?? [], status.containerStatuses ?? []], ['ephemeral', spec.ephemeralContainers ?? [], status.ephemeralContainerStatuses ?? []]] as const;
  const result: ContainerStopEvidence[] = [];
  const sandboxGone = status.conditions?.some((c) => c.type === 'PodReadyToStartContainers' && c.status === 'False');
  for (const [kind, expected, observed] of groups) {
    if (observed.some((c) => !expected.some((e) => e.name === c.name)) || new Set(observed.map((c) => c.name)).size !== observed.length) return undefined;
    for (const c of expected) {
      const state = observed.find((s) => s.name === c.name), ended = state?.state?.terminated;
      if (ended && !neverScheduled) {
        const containerId = ended.containerID ?? state?.containerID;
        if (!containerId || !Number.isInteger(ended.exitCode) || !ended.finishedAt || ended.reason === 'ContainerStatusUnknown' || state?.state?.running || state?.state?.waiting) return undefined;
        result.push({ kind, name: c.name, state: 'terminated', containerId, exitCode: ended.exitCode! });
      } else if ((neverScheduled || sandboxGone) && neverRan(state)) result.push({ kind, name: c.name, state: 'never-started', containerId: null, exitCode: null });
      else return undefined;
    }
  }
  return result.length && new Set(result.map((c) => c.name)).size === result.length ? result : undefined;
}

/** A terminal phase alone, API disappearance or an expired lease never proves that a writer stopped. */
export function classifyWorkloadStop(consumer: WorkloadConsumer, pod: ObservedObject | undefined, node: StopNodeEvidence | undefined, now: Date): WorkloadStopObservation {
  if (!pod) return blocked('pod_missing_without_stop_proof');
  const meta = pod.metadata, spec = (pod.spec ?? {}) as PodSpec, status = (pod.status ?? {}) as PodStatus;
  if (meta.name !== consumer.podName || meta.namespace !== consumer.namespace || !meta.uid || !meta.resourceVersion || meta.annotations?.[WORKLOAD_CONSUMER_ANNOTATION] !== consumer.id) return blocked('consumer_identity_mismatch');
  if (!meta.finalizers?.includes(WORKLOAD_STOP_FINALIZER)) return blocked('stop_observation_unprotected');
  const neverScheduled = !spec.nodeName;
  if (neverScheduled && !meta.deletionTimestamp) return blocked('unscheduled_pod_admission_open');
  if (!neverScheduled) {
    if (!node || node.name !== spec.nodeName || !node.ready || !node.leaseFresh) return blocked('node_stop_observation_unknown');
    const version = /^v1\.(\d+)\./.exec(node.kubeletVersion);
    if (!version || Number(version[1]) < 27) return blocked('kubelet_stop_observation_unsupported');
    if (status.reason === 'NodeLost' || !['Failed', 'Succeeded'].includes(status.phase ?? '')) return blocked('pod_termination_pending');
  }
  const containers = containersOf(spec, status, neverScheduled);
  if (!containers) return blocked('container_stop_observation_incomplete');
  return { state: 'proved', proof: { id: newResourceId(), consumer, podUid: meta.uid, type: neverScheduled ? 'never-scheduled' : 'kubelet-terminated',
    nodeName: node?.name ?? null, nodeUid: node?.uid ?? null, podResourceVersion: meta.resourceVersion, observedAt: now.toISOString(), containers } };
}
