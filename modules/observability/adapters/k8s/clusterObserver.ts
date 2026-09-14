import type { LogEntryDto } from '@crewstation/contracts';
import { LogEntryDtoSchema } from '@crewstation/contracts';
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
        const stream = await k8s.logs(namespace, pod.metadata.name, { timestamps: true, tailLines: options.tailLines, ...(options.sinceSeconds ? { sinceSeconds: options.sinceSeconds } : {}) });
        const text = await new Response(stream).text();
        for (const line of text.split('\n')) {
          if (!line) continue;
          entries.push(logEntry(line, pod.metadata.name));
        }
      }
      // 未知时间保留读取顺序，放在已知时间之后，不伪造其与其他 Pod 的时间关系。
      return entries.sort((a, b) => a.ts === undefined ? (b.ts === undefined ? 0 : 1) : b.ts === undefined ? -1 : a.ts.localeCompare(b.ts)).slice(-options.tailLines);
    },
  };
}

function logEntry(line: string, pod: string): LogEntryDto {
  const space = line.indexOf(' ');
  const timestamp = LogEntryDtoSchema.shape.ts.safeParse(space > 0 ? line.slice(0, space) : '');
  const value = timestamp.success ? timestamp.data : undefined;
  return {
    ...(value === undefined ? {} : { ts: new Date(value).toISOString() }),
    source: 'slot', pod, stream: 'combined',
    message: value === undefined ? line : line.slice(space + 1),
  };
}
