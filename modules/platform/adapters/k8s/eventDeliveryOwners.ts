import { jsonHash, precondition } from '@crewstation/kernel';
import { Resources, type K8sClient, type K8sObject } from '@crewstation/k8s';
import { freshPlatformNode, protectedPlatformPodStopped, validPlatformTermination } from './platformPodTermination';
import type { PlatformContainer } from './platformPodTermination';

export const EVENT_DELIVERY_FINALIZER = 'crewstation.io/events-delivery-stop';
interface Process { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly nodeName: string }
interface Acceptance { stopped(process: Process, digest: string): Promise<void>; releasable(podUid: string): Promise<boolean> }
const APPLICATIONS: readonly string[] = ['cs-events','cs-api','cs-controller'];
function application(pod: K8sObject) { const name = pod.metadata.labels?.['app.kubernetes.io/name']; return name && APPLICATIONS.includes(name) ? name : undefined; }
function hostContainer(pod: K8sObject): PlatformContainer | undefined {
  const statuses = (pod['status'] as { containerStatuses?: PlatformContainer[] } | undefined)?.containerStatuses;
  const name = application(pod);
  return name && statuses?.filter((c) => c.name === name).length === 1 ? statuses.find((c) => c.name === name) : undefined;
}
async function list(k8s: K8sClient, namespace: string): Promise<K8sObject[]> {
  const pods: K8sObject[] = [],seen = new Set<string>(); let cursor: string | undefined;
  do {
    const page = await k8s.listPage(Resources.Pod!,namespace,{ labelSelector: 'app.kubernetes.io/part-of=crewstation',limit: 100,signal: AbortSignal.timeout(5000),...(cursor ? { continue: cursor } : {}) });
    pods.push(...page.items.filter((p) => application(p))); cursor = page.continue || undefined;
    if (cursor && seen.has(cursor)) throw precondition('投递进程盘点分页游标重复');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return pods;
}
/** 原容器退出和原节点的新鲜物理来源；全 Pod 退出后才移除本 owner 的保护。 */
export function eventDeliveryOwners(k8s: K8sClient, namespace: string, currentPodUid?: string) {
  return {
    protectCurrent: async (): Promise<Process> => {
      if (!currentPodUid) throw precondition('当前投递进程缺少原 Pod UID');
      const matches = (await list(k8s,namespace)).filter((pod) => pod.metadata.uid === currentPodUid);
      const pod = matches.length === 1 ? matches[0] : undefined,container = pod && hostContainer(pod),node = pod && await freshPlatformNode(k8s,pod);
      const declared = (pod?.['spec'] as { containers?: Array<{ name: string }> } | undefined)?.containers;
      if (!pod || pod.metadata.deletionTimestamp || !pod.metadata.resourceVersion || !container?.containerID || !container.state?.running || !node
        || declared?.filter((c) => c.name === application(pod)).length !== 1) throw precondition('原投递容器或节点身份不可验证');
      if (!pod.metadata.finalizers?.includes(EVENT_DELIVERY_FINALIZER)) await k8s.jsonPatch(Resources.Pod!,pod.metadata.name,namespace,[
        { op: 'test',path: '/metadata/uid',value: currentPodUid },{ op: 'test',path: '/metadata/resourceVersion',value: pod.metadata.resourceVersion },
        { op: pod.metadata.finalizers ? 'replace' : 'add',path: '/metadata/finalizers',value: [...pod.metadata.finalizers ?? [],EVENT_DELIVERY_FINALIZER] },
      ]);
      return { podUid: currentPodUid,containerId: container.containerID,nodeUid: node.uid,nodeName: node.name };
    },
    sweep: async (accept: Acceptance) => {
      for (const pod of await list(k8s,namespace)) {
        if (!pod.metadata.uid || !pod.metadata.resourceVersion || !pod.metadata.finalizers?.includes(EVENT_DELIVERY_FINALIZER)) continue;
        const node = await freshPlatformNode(k8s,pod),container = hostContainer(pod);
        if (node && container) for (const ended of [container.lastState?.terminated,container.state?.terminated]) {
          if (!validPlatformTermination(ended)) continue;
          const process = { podUid: pod.metadata.uid,containerId: ended.containerID,nodeUid: node.uid,nodeName: node.name };
          await accept.stopped(process,jsonHash({ process,resourceVersion: pod.metadata.resourceVersion,ended }));
        }
        if (!await protectedPlatformPodStopped(k8s,pod,EVENT_DELIVERY_FINALIZER) || !await accept.releasable(pod.metadata.uid)) continue;
        await k8s.jsonPatch(Resources.Pod!,pod.metadata.name,namespace,[{ op: 'test',path: '/metadata/uid',value: pod.metadata.uid },{ op: 'test',path: '/metadata/resourceVersion',value: pod.metadata.resourceVersion },
          { op: 'replace',path: '/metadata/finalizers',value: pod.metadata.finalizers.filter((f) => f !== EVENT_DELIVERY_FINALIZER) }]);
      }
    },
  };
}
