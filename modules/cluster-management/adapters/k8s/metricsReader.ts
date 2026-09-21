import type { K8sClient } from '@crewstation/k8s';
import { Resources, parseMetricsJson } from '@crewstation/k8s';
import type { MetricsReader } from '../../ports/metrics';
import type { ResourceObject } from '../../domain/inventory';

async function listAll(k8s: K8sClient, kind: string, signal: AbortSignal): Promise<ResourceObject[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const items = new Map<string, ResourceObject>(); let cursor = '';
    try {
      do {
        const page = await k8s.listPage<ResourceObject>(Resources[kind]!, undefined, { limit: 500, continue: cursor, signal });
        for (const item of page.items) if (item.metadata.uid) items.set(item.metadata.uid, item);
        if (items.size > 100_000) throw new Error(`${kind} inventory exceeds the collection limit`);
        if (cursor && page.continue === cursor) throw new Error(`${kind} pagination did not advance`);
        cursor = page.continue;
      } while (cursor);
      return [...items.values()];
    } catch (e) { if (attempt || !String(e).includes('410')) throw e; }
  }
  throw new Error('Kubernetes pagination expired');
}
export function kubernetesMetricsReader(k8s: K8sClient): MetricsReader {
  return {
    topology: async (signal) => {
      const [nodes, pods, pvcs, volumes] = await Promise.all(['Node', 'Pod', 'PersistentVolumeClaim', 'PersistentVolume'].map((kind) => listAll(k8s, kind, signal)));
      return { nodes: nodes!, pods: pods!, pvcs: pvcs!, volumes: volumes! };
    },
    sample: async (node, signal) => {
      const [summary, cadvisor] = await Promise.allSettled([k8s.nodeMetrics(node, 'summary', signal).then(parseMetricsJson), k8s.nodeMetrics(node, 'cadvisor', signal)]);
      const live = await k8s.get(Resources.Node!, node, undefined, signal);
      return { nodeUid: live?.metadata.uid, ...(summary.status === 'fulfilled' ? { summary: summary.value } : {}), ...(cadvisor.status === 'fulfilled' ? { cadvisor: cadvisor.value } : {}), errors: [summary, cadvisor].flatMap((r, i) => r.status === 'rejected' ? [`${i === 0 ? 'summary' : 'cadvisor'}: ${String(r.reason)}`] : []) };
    },
  };
}
