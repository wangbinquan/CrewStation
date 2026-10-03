import { jsonHash, precondition } from '@crewstation/kernel';
import { Resources, type K8sClient, type K8sObject } from '@crewstation/k8s';
import { freshPlatformNode, protectedPlatformPodStopped, validPlatformTermination } from './platformPodTermination';
import type { PlatformContainer } from './platformPodTermination';
import { readFile, readlink } from 'node:fs/promises';
import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';

export const EVENT_DELIVERY_FINALIZER = 'crewstation.io/events-delivery-stop';
interface Process { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly nodeName: string }
interface Acceptance { stopped(process: Process, digest: string): Promise<void>; releasable(podUid: string): Promise<boolean>;
  podStopped?(process: Omit<Process, 'containerId'>, digest: string): Promise<void> }
const APPLICATIONS: readonly string[] = ['cs-events','cs-api','cs-controller'];
export async function currentProcessBirth(source = { stat: () => readFile('/proc/self/stat', 'utf8'),
  namespace: () => readlink('/proc/self/ns/pid'), bootId: () => readFile('/proc/sys/kernel/random/boot_id', 'utf8') }) {
  const parse = (body: string) => {
    const end = body.lastIndexOf(')'), fields = body.slice(end + 2).trim().split(/\s+/), pid = Number(body.slice(0, body.indexOf('(')).trim());
    if (end < 0 || pid !== process.pid || !/^[0-9]+$/.test(fields[19] ?? '')) throw precondition('平台原进程出生字段不可读取');
    return { pid, startTicks: fields[19]! };
  };
  const before = parse(await source.stat());
  const [namespace, bootId] = await Promise.all([source.namespace(), source.bootId()]);
  const after = parse(await source.stat()), pidNamespace = /^pid:\[([0-9]+)\]$/.exec(namespace)?.[1];
  if (!pidNamespace || jsonHash(before) !== jsonHash(after) || !/^[0-9a-f-]{36}$/.test(bootId.trim())) throw precondition('平台原进程在读取期间变化');
  return { ...before, pidNamespace, bootId: bootId.trim() };
}
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
  return projectCallbackOwners(k8s, namespace, currentPodUid, EVENT_DELIVERY_FINALIZER);
}

export function provisioningWorkPorts(k8s: K8sClient, namespace: string, podUid: string | undefined,
  source: { assertProjectAvailable(id: ProjectId): Promise<void>; assertProjectDeletionGrant(context: ProjectDeletionContext): Promise<void> }) {
  if (!podUid) return {};
  const owners = projectCallbackOwners(k8s, namespace, podUid, 'crewstation.io/provisioning-project-stop');
  return { projectWork: { processes: { protectCurrent: owners.protectCurrentProcess, sweep: owners.sweep },
    assertAvailable: source.assertProjectAvailable, assertGrant: source.assertProjectDeletionGrant } };
}

/** 每个内容 owner 的原回调使用独立保护，停止证明不跨 owner 冒用。 */
export function projectCallbackOwners(k8s: K8sClient, namespace: string, currentPodUid: string | undefined, finalizer: 'crewstation.io/events-delivery-stop' | 'crewstation.io/gateway-project-stop' | 'crewstation.io/data-control-native-stop' | 'crewstation.io/scm-project-stop' | 'crewstation.io/cluster-project-stop' | 'crewstation.io/provisioning-project-stop', readBirth = currentProcessBirth) {
  const owners = {
    protectCurrent: async (): Promise<Process> => {
      if (!currentPodUid) throw precondition('当前投递进程缺少原 Pod UID');
      const matches = (await list(k8s,namespace)).filter((pod) => pod.metadata.uid === currentPodUid);
      const pod = matches.length === 1 ? matches[0] : undefined,container = pod && hostContainer(pod),node = pod && await freshPlatformNode(k8s,pod);
      const declared = (pod?.['spec'] as { containers?: Array<{ name: string }> } | undefined)?.containers;
      if (!pod || pod.metadata.deletionTimestamp || !pod.metadata.resourceVersion || !container?.containerID || !container.state?.running || !node
        || declared?.filter((c) => c.name === application(pod)).length !== 1) throw precondition('原投递容器或节点身份不可验证');
      if (!pod.metadata.finalizers?.includes(finalizer)) await k8s.jsonPatch(Resources.Pod!,pod.metadata.name,namespace,[
        { op: 'test',path: '/metadata/uid',value: currentPodUid },{ op: 'test',path: '/metadata/resourceVersion',value: pod.metadata.resourceVersion },
        { op: pod.metadata.finalizers ? 'replace' : 'add',path: '/metadata/finalizers',value: [...pod.metadata.finalizers ?? [],finalizer] },
      ]);
      return { podUid: currentPodUid,containerId: container.containerID,nodeUid: node.uid,nodeName: node.name };
    },
    sweep: async (accept: Acceptance) => {
      for (const pod of await list(k8s,namespace)) {
        if (!pod.metadata.uid || !pod.metadata.resourceVersion || !pod.metadata.finalizers?.includes(finalizer)) continue;
        const podStopped = await protectedPlatformPodStopped(k8s,pod,finalizer);
        const node = await freshPlatformNode(k8s,pod),container = hostContainer(pod);
        if (finalizer === 'crewstation.io/provisioning-project-stop') {
          // A PID birth and a potentially delayed container status do not establish PID-to-CID correlation.
          if (node && podStopped && accept.podStopped) {
            const process = { podUid: pod.metadata.uid,nodeUid: node.uid,nodeName: node.name };
            await accept.podStopped(process,jsonHash({ process,resourceVersion: pod.metadata.resourceVersion,status: pod['status'] }));
          }
        } else if (node && container) for (const ended of [container.lastState?.terminated,container.state?.terminated]) {
          if (!validPlatformTermination(ended)) continue;
          const process = { podUid: pod.metadata.uid,containerId: ended.containerID,nodeUid: node.uid,nodeName: node.name };
          await accept.stopped(process,jsonHash({ process,resourceVersion: pod.metadata.resourceVersion,ended }));
        }
        if (!podStopped || !await accept.releasable(pod.metadata.uid)) continue;
        await k8s.jsonPatch(Resources.Pod!,pod.metadata.name,namespace,[{ op: 'test',path: '/metadata/uid',value: pod.metadata.uid },{ op: 'test',path: '/metadata/resourceVersion',value: pod.metadata.resourceVersion },
          { op: 'replace',path: '/metadata/finalizers',value: pod.metadata.finalizers.filter((f) => f !== finalizer) }]);
      }
    },
  };
  return { ...owners, protectCurrentProcess: async () => {
    const before = await readBirth(), original = await owners.protectCurrent(), after = await readBirth();
    if (jsonHash(before) !== jsonHash(after)) throw precondition('受保护平台原进程在读取期间变化');
    return { ...original, ...before };
  } };
}
