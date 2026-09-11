import type { LogEntryDto } from '@crewstation/contracts';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import type { ClusterObserver } from '../../ports/sources';

type Deployment = K8sObject & { spec?: { replicas?: number }; status?: { replicas?: number; readyReplicas?: number; conditions?: Array<{ type: string; lastTransitionTime?: string }> } };
type Pod = K8sObject & { status?: { containerStatuses?: Array<{ restartCount?: number; lastState?: { terminated?: { finishedAt?: string } } }> } };

/** 直接读集群：Deployment 状态与按标签选中的 Pod 的日志尾部。 */
export function kubernetesClusterObserver(k8s: K8sClient): ClusterObserver {
  return {
    observeDeployment: async (namespace, name) => {
      const dep = await k8s.get<Deployment>(Resources.Deployment!, name, namespace);
      if (!dep) return undefined;
      const pods = await k8s.list<Pod>(Resources.Pod!, namespace, { labelSelector: `crewstation.io/service=${name.replace(/-(blue|green)$/, '')},crewstation.io/slot=${name.split('-').at(-1)}` });
      let restarts = 0;
      let lastRestart: number | undefined;
      for (const pod of pods) for (const c of pod.status?.containerStatuses ?? []) {
        restarts += c.restartCount ?? 0;
        const finished = c.lastState?.terminated?.finishedAt ? Date.parse(c.lastState.terminated.finishedAt) : undefined;
        if (finished !== undefined) lastRestart = Math.max(lastRestart ?? 0, finished);
      }
      const transition = dep.status?.conditions?.map((c) => c.lastTransitionTime).filter((t): t is string => Boolean(t)).sort().at(-1);
      return { replicas: dep.spec?.replicas ?? 0, readyReplicas: dep.status?.readyReplicas ?? 0, restarts, ...(lastRestart ? { lastRestartAgeSeconds: Math.round((Date.now() - lastRestart) / 1000) } : {}), lastTransitionAt: transition ?? new Date().toISOString() };
    },
    tailLogs: async (namespace, selector, options) => {
      const pods = await k8s.list<Pod>(Resources.Pod!, namespace, { labelSelector: selector });
      const entries: LogEntryDto[] = [];
      for (const pod of pods) {
        const stream = await k8s.logs(namespace, pod.metadata.name, { tailLines: options.tailLines, ...(options.sinceSeconds ? { sinceSeconds: options.sinceSeconds } : {}) }).catch(() => undefined);
        if (!stream) continue;
        const text = await new Response(stream).text();
        for (const line of text.split('\n')) {
          if (!line) continue;
          const space = line.indexOf(' ');
          const ts = space > 0 && !Number.isNaN(Date.parse(line.slice(0, space))) ? line.slice(0, space) : new Date().toISOString();
          entries.push({ ts: new Date(ts).toISOString(), source: 'slot', pod: pod.metadata.name, stream: 'stdout', message: space > 0 && ts !== line.slice(0, space) ? line : line.slice(space + 1) });
        }
      }
      return entries.sort((a, b) => a.ts.localeCompare(b.ts)).slice(-options.tailLines);
    },
  };
}
