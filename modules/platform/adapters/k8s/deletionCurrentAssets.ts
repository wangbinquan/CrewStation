import type { ProjectDeletionCurrentAssets, ProjectDeletionCurrentPod } from '@crewstation/contracts';
import { LABELS, Resources } from '@crewstation/k8s';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';

function mentions(value: unknown, ids: readonly string[]): boolean {
  if (typeof value === 'string') return ids.some(id => id.length > 0 && value.includes(id));
  if (Array.isArray(value)) return value.some(entry => mentions(entry, ids));
  return !!value && typeof value === 'object' && Object.entries(value).some(([key, entry]) => mentions(key, ids) || mentions(entry, ids));
}

function physicalPod(pod: K8sObject): ProjectDeletionCurrentPod {
  if (!pod.metadata.uid || !pod.metadata.namespace || !pod.metadata.name) throw precondition('当前消费者缺少实际 Pod 完整身份');
  type Container = { name: string; containerID?: string };
  const status = pod['status'] as { phase?: string; containerStatuses?: Container[]; initContainerStatuses?: Container[]; ephemeralContainerStatuses?: Container[] } | undefined;
  const spec = pod['spec'] as { containers?: { name: string }[]; initContainers?: { name: string }[]; ephemeralContainers?: { name: string }[] } | undefined;
  const declared = [...(spec?.containers ?? []), ...(spec?.initContainers ?? []), ...(spec?.ephemeralContainers ?? [])].map((c) => c.name);
  const containers = [...(status?.containerStatuses ?? []), ...(status?.initContainerStatuses ?? []), ...(status?.ephemeralContainerStatuses ?? [])].map((c) => ({ name: c.name, id: c.containerID ?? null })).sort((a, b) => a.name.localeCompare(b.name));
  const containersComplete = declared.length > 0 && containers.length === declared.length && new Set(declared).size === declared.length && new Set(containers.map((c) => c.name)).size === containers.length && declared.every((name) => containers.some((c) => c.name === name && !!c.id));
  return { namespace: pod.metadata.namespace, name: pod.metadata.name, uid: pod.metadata.uid, labels: pod.metadata.labels ?? {}, phase: status?.phase ?? null,
    terminating: !!pod.metadata.deletionTimestamp, containersComplete, containers };
}

/** Complete current Pod snapshot and its matched original objects share the same EOF and digest. */
export async function inspectDeletionCurrentAssets(k8s: K8sClient, target: Parameters<ProjectDeletionCurrentAssets['inspect']>[0], selectors: Parameters<ProjectDeletionCurrentAssets['inspect']>[1]) {
    const pods: K8sObject[] = [], cursors = new Set<string>(); let cursor = '', revision: string | undefined;
    for (;;) {
      const page = await k8s.listPage(Resources.Pod!, undefined, { limit: 500, ...(cursor ? { continue: cursor } : {}), signal: AbortSignal.timeout(30_000) });
      if (!Array.isArray(page.items) || !page.resourceVersion || revision && revision !== page.resourceVersion || cursors.has(page.continue) && page.continue) throw precondition('当前消费者完整分页或来源不一致');
      revision = page.resourceVersion; pods.push(...page.items);
      if (!page.continue) break;
      cursors.add(page.continue); cursor = page.continue;
    }
    const activeConsumers: string[] = [], targetReferences: string[] = [], evidence: ProjectDeletionCurrentPod[] = [], bindings: unknown[] = [], matched: K8sObject[] = [];
    for (const pod of pods) {
      const labels = pod.metadata.labels ?? {}, selector = selectors.pods?.find((entry) => entry.namespace === pod.metadata.namespace && entry.name === pod.metadata.name);
      const binding = { labels, annotations: pod.metadata.annotations, owners: pod.metadata.ownerReferences, name: pod.metadata.name, namespace: pod.metadata.namespace, spec: pod['spec'] };
      const matches = selector || mentions(binding, selectors.ids);
      if (!matches) continue;
      if (!pod.metadata.uid) throw precondition('当前消费者缺少实际 Pod UID');
      const status = pod['status'] as { phase?: string; containerStatuses?: { name: string; containerID?: string; state?: unknown }[] } | undefined;
      const key = `${pod.metadata.namespace}/${pod.metadata.name}@${pod.metadata.uid}`;
      evidence.push(physicalPod(pod));
      matched.push(pod);
      bindings.push(binding);
      if (selector && selector.uid !== pod.metadata.uid || status?.phase !== 'Succeeded' && status?.phase !== 'Failed') activeConsumers.push(key);
      const targetIds = [target.id, target.serviceId, target.namespace, target.prodHost, target.previewHost, target.serviceHost].filter((id): id is string => !!id);
      if (labels[LABELS.project] === target.slug || mentions(binding, targetIds)) targetReferences.push(key);
    }
    return { assets: { complete: true as const, digest: jsonHash({ target: target.id, selectors, evidence: evidence.sort((a, b) => jsonHash(a).localeCompare(jsonHash(b))), bindings: bindings.sort((a, b) => jsonHash(a).localeCompare(jsonHash(b))) }), activeConsumers: activeConsumers.sort(), targetReferences: targetReferences.sort(), pods: evidence }, pods: matched };
}

/** A negative current match guards a reviewed retention decision, never an old exit proof. */
export function deletionCurrentAssets(k8s: K8sClient): ProjectDeletionCurrentAssets {
  return { inspect: async (target, selectors) => (await inspectDeletionCurrentAssets(k8s, target, selectors)).assets };
}
