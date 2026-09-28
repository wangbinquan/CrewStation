import { isIP } from 'node:net';
import { precondition } from '@crewstation/kernel';
import type { K8sClient, K8sObject } from '@crewstation/k8s';

const consumers = { 'cs-api': 8080, 'cs-auth': 8081, 'cs-controller': 8082, 'cs-session': 8083, 'cs-events': 8084, console: 8090 };
interface Pod extends K8sObject { status?: { phase?: string; podIP?: string; containerStatuses?: Array<{ state?: { terminated?: object } }> } }
/** Probe every actual Pod incarnation, including old ReplicaSets. A template annotation cannot attest a running binary. */
export async function assertStorageConsumers(k8s: K8sClient, namespace: string, version: number, fetcher: typeof fetch = fetch): Promise<void> {
  const seen = new Set<string>(); let cursor: string | undefined, count = 0;
  do {
    const page = await k8s.listPage<Pod>({ apiVersion: 'v1', plural: 'pods', kind: 'Pod', namespaced: true }, namespace, { labelSelector: 'app.kubernetes.io/part-of=crewstation', limit: 100, ...(cursor ? { continue: cursor } : {}) });
    for (const pod of page.items) {
      const role = pod.metadata.labels?.['app.kubernetes.io/name'];
      if (!role || !Object.hasOwn(consumers, role)) continue;
      const states = pod.status?.containerStatuses;
      if (['Succeeded', 'Failed'].includes(pod.status?.phase ?? '') && states?.length && states.every((c) => c.state?.terminated)) continue;
      if (++count > 1000) throw precondition('控制面实例超过兼容检查上限');
      const ip = pod.status?.podIP;
      if (!pod.metadata.uid || !ip || !isIP(ip)) throw precondition('控制面实例身份尚未确认', { component: role });
      const host = isIP(ip) === 6 ? `[${ip}]` : ip, port = consumers[role as keyof typeof consumers];
      try {
        const response = await fetcher(`http://${host}:${port}/${role === 'console' ? 'storage-contract.json' : 'internal/storage-contract'}`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
        if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('unavailable'); }
        const reader = response.body.getReader(); let text = '', size = 0;
        try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 1024) throw new Error('oversized'); text += new TextDecoder().decode(chunk.value); } }
        finally { await reader.cancel(); reader.releaseLock(); }
        const marker = JSON.parse(text) as { name?: string; storageContractVersion?: number };
        if (marker.name !== role || !Number.isSafeInteger(marker.storageContractVersion) || marker.storageContractVersion! < version) throw new Error('incompatible');
        seen.add(role);
      } catch { throw precondition('旧版或未知控制面实例尚未退出，不能启用对象存储', { code: 'storage_consumers_incompatible', component: role, pod: pod.metadata.name }); }
    }
    cursor = page.continue || undefined;
  } while (cursor);
  if (Object.keys(consumers).some((role) => !seen.has(role))) throw precondition('对象存储所需控制面或工作台尚未全部就绪', { code: 'storage_consumers_missing' });
}
