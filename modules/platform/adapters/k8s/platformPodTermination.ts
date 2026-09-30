import { Resources, type K8sClient, type K8sObject } from '@crewstation/k8s';

export interface PlatformContainer {
  name: string; containerID?: string; restartCount?: number; started?: boolean;
  state?: { running?: unknown; waiting?: unknown; terminated?: PlatformTermination };
  lastState?: { running?: unknown; terminated?: PlatformTermination };
}
export interface PlatformTermination { containerID?: string; finishedAt?: string; exitCode?: number; reason?: string }
export function validPlatformTermination(ended: PlatformTermination | undefined): ended is PlatformTermination & { containerID: string; finishedAt: string; exitCode: number } {
  return !!ended?.containerID && Number.isInteger(ended.exitCode) && !!ended.finishedAt && Number.isFinite(Date.parse(ended.finishedAt)) && ended.reason !== 'ContainerStatusUnknown';
}
export async function freshPlatformNode(k8s: K8sClient, pod: K8sObject): Promise<{ uid: string; name: string } | undefined> {
  const spec = pod['spec'] as { nodeName?: string } | undefined;
  const status = pod['status'] as { reason?: string } | undefined;
  if (!spec?.nodeName || status?.reason === 'NodeLost') return;
  const node = await k8s.get(Resources.Node!, spec.nodeName, undefined, AbortSignal.timeout(5000));
  const nodeStatus = node?.['status'] as { conditions?: Array<{ type: string; status: string }>; nodeInfo?: { kubeletVersion?: string } } | undefined;
  const lease = await k8s.get(Resources.Lease!, spec.nodeName, 'kube-node-lease', AbortSignal.timeout(5000));
  const leaseSpec = lease?.['spec'] as { holderIdentity?: string; renewTime?: string } | undefined;
  const age = Date.now()-Date.parse(leaseSpec?.renewTime ?? '');
  const version = /^v1\.(\d+)\./.exec(nodeStatus?.nodeInfo?.kubeletVersion ?? '');
  if (version && Number(version[1]) >= 27 && node?.metadata.uid && nodeStatus?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True')
    && leaseSpec?.holderIdentity === spec.nodeName && age >= -5000 && age <= 40_000 && lease?.metadata.ownerReferences?.some((r) => r.kind === 'Node' && r.uid === node.metadata.uid)) return { uid: node.metadata.uid,name: spec.nodeName };
}
export async function protectedPlatformPodStopped(k8s: K8sClient, pod: K8sObject, finalizer: string): Promise<boolean> {
  const meta = pod.metadata, spec = pod['spec'] as { nodeName?: string; containers?: Array<{ name: string }>; initContainers?: Array<{ name: string }>; ephemeralContainers?: Array<{ name: string }> } | undefined;
  const status = pod['status'] as { phase?: string; conditions?: Array<{ type: string; status: string }>; containerStatuses?: PlatformContainer[]; initContainerStatuses?: PlatformContainer[]; ephemeralContainerStatuses?: PlatformContainer[] } | undefined;
  if (!meta.uid || !meta.resourceVersion || !meta.deletionTimestamp || !meta.finalizers?.includes(finalizer) || !spec) return false;
  const expected = [...spec.containers ?? [],...spec.initContainers ?? [],...spec.ephemeralContainers ?? []],actual = [...status?.containerStatuses ?? [],...status?.initContainerStatuses ?? [],...status?.ephemeralContainerStatuses ?? []];
  const neverScheduled = !spec.nodeName,sandboxGone = !!status?.conditions?.some((c) => c.type === 'PodReadyToStartContainers' && c.status === 'False');
  if (!expected.length || new Set(actual.map((c) => c.name)).size !== actual.length || actual.some((c) => !expected.some((e) => e.name === c.name))) return false;
  if (expected.some((c) => !containerStopped(actual.find((a) => a.name === c.name),neverScheduled,sandboxGone))) return false;
  if (neverScheduled) return true;
  return ['Succeeded','Failed'].includes(status?.phase ?? '') && !!await freshPlatformNode(k8s,pod);
}
function containerStopped(container: PlatformContainer | undefined, neverScheduled: boolean, sandboxGone: boolean): boolean {
  const ended = container?.state?.terminated;
  if (ended) return !neverScheduled && !!(ended.containerID ?? container?.containerID) && Number.isInteger(ended.exitCode) && !!ended.finishedAt && ended.reason !== 'ContainerStatusUnknown' && !container?.state?.running && !container?.state?.waiting;
  return (neverScheduled || sandboxGone) && (!container || (!container.containerID && !container.state?.running && !container.lastState?.running && !container.lastState?.terminated && (container.restartCount ?? 0) === 0 && container.started !== true));
}
