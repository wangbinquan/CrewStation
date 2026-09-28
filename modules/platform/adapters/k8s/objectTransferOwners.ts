import { jsonHash } from '@crewstation/kernel';
import { Resources, type K8sClient, type K8sObject } from '@crewstation/k8s';

export const OBJECT_TRANSFER_FINALIZER = 'crewstation.io/object-transfer-stop';
interface Container {
  name: string; containerID?: string; restartCount?: number; started?: boolean;
  state?: { running?: unknown; waiting?: unknown; terminated?: { containerID?: string; finishedAt?: string; exitCode?: number; reason?: string } };
  lastState?: { running?: unknown; terminated?: unknown };
}
/** Retain the actual Pod until data has durably released its reads; unknown writes remain independently protected. */
export function objectTransferOwners(k8s: K8sClient, namespace: string, podUid?: string) {
  return { ...(podUid ? { podUid } : {}), sweep: async (accept: (uid: string, digest: string) => Promise<void>) => {
    let cursor: string | undefined;
    do {
      const page = await k8s.listPage(Resources.Pod!, namespace, { labelSelector: 'app.kubernetes.io/name=cs-api,app.kubernetes.io/part-of=crewstation', limit: 100, ...(cursor ? { continue: cursor } : {}) });
      for (const pod of page.items) {
        if (!await stopped(k8s, pod)) continue;
        await accept(pod.metadata.uid!, jsonHash({ uid: pod.metadata.uid, status: pod['status'] }));
        await k8s.jsonPatch(Resources.Pod!, pod.metadata.name, namespace, [
          { op: 'test', path: '/metadata/uid', value: pod.metadata.uid }, { op: 'test', path: '/metadata/resourceVersion', value: pod.metadata.resourceVersion },
          { op: 'replace', path: '/metadata/finalizers', value: pod.metadata.finalizers!.filter((f) => f !== OBJECT_TRANSFER_FINALIZER) },
        ]);
      }
      cursor = page.continue || undefined;
    } while (cursor);
  } };
}
async function stopped(k8s: K8sClient, pod: K8sObject): Promise<boolean> {
  const meta = pod.metadata, spec = pod['spec'] as { nodeName?: string; containers?: Array<{ name: string }>; initContainers?: Array<{ name: string }>; ephemeralContainers?: Array<{ name: string }> } | undefined;
  const status = pod['status'] as { phase?: string; reason?: string; conditions?: Array<{ type: string; status: string }>; containerStatuses?: Container[]; initContainerStatuses?: Container[]; ephemeralContainerStatuses?: Container[] } | undefined;
  if (!meta.uid || !meta.resourceVersion || !meta.deletionTimestamp || !meta.finalizers?.includes(OBJECT_TRANSFER_FINALIZER) || !spec) return false;
  const expected = [...spec.containers ?? [], ...spec.initContainers ?? [], ...spec.ephemeralContainers ?? []], actual = [...status?.containerStatuses ?? [], ...status?.initContainerStatuses ?? [], ...status?.ephemeralContainerStatuses ?? []];
  const neverScheduled = !spec.nodeName, sandboxGone = !!status?.conditions?.some((c) => c.type === 'PodReadyToStartContainers' && c.status === 'False');
  if (!expected.length || new Set(actual.map((c) => c.name)).size !== actual.length || actual.some((c) => !expected.some((e) => e.name === c.name))) return false;
  if (expected.some((c) => !containerStopped(actual.find((a) => a.name === c.name), neverScheduled, sandboxGone))) return false;
  // Deletion closes scheduler admission. A Pod that never had a node cannot have a running container.
  if (neverScheduled) return true;
  if (status?.reason === 'NodeLost' || !['Succeeded', 'Failed'].includes(status?.phase ?? '')) return false;
  const node = await k8s.get(Resources.Node!, spec.nodeName!, undefined, AbortSignal.timeout(5000));
  const nodeStatus = node?.['status'] as { conditions?: Array<{ type: string; status: string }>; nodeInfo?: { kubeletVersion?: string } } | undefined;
  const lease = await k8s.get(Resources.Lease!, spec.nodeName!, 'kube-node-lease', AbortSignal.timeout(5000));
  const leaseSpec = lease?.['spec'] as { holderIdentity?: string; renewTime?: string } | undefined;
  const age = Date.now() - Date.parse(leaseSpec?.renewTime ?? '');
  const version = /^v1\.(\d+)\./.exec(nodeStatus?.nodeInfo?.kubeletVersion ?? '');
  return !!version && Number(version[1]) >= 27 && !!node?.metadata.uid && !!nodeStatus?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True') && leaseSpec?.holderIdentity === spec.nodeName && age >= -5000 && age <= 40_000
    && !!lease?.metadata.ownerReferences?.some((r) => r.kind === 'Node' && r.uid === node.metadata.uid);
}
function containerStopped(container: Container | undefined, neverScheduled: boolean, sandboxGone: boolean): boolean {
  const ended = container?.state?.terminated;
  if (ended) return !neverScheduled && !!(ended.containerID ?? container?.containerID) && Number.isInteger(ended.exitCode) && !!ended.finishedAt && ended.reason !== 'ContainerStatusUnknown' && !container?.state?.running && !container?.state?.waiting;
  return (neverScheduled || sandboxGone) && (!container || (!container.containerID && !container.state?.running && !container.lastState?.running && !container.lastState?.terminated && (container.restartCount ?? 0) === 0 && container.started !== true));
}
