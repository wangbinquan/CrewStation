import { conflict, notFound, precondition } from '@crewstation/kernel';
import type { K8sClient, JsonPatch, ResourceRef } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import type { ClusterResource } from '@crewstation/contracts';
import type { ClusterReader } from '../../ports/cluster';
import { configRevision } from '../../domain/projection';
import { objectArray, objectRecord } from '../../domain/inventory';
import type { ResourceObject } from '../../domain/inventory';
const restartKey = 'crewstation.io/cluster-operation';
const refFor = (r: ClusterResource): ResourceRef => Resources[r.kind]!;
export function kubernetesClusterReader(k8s: K8sClient, physicalOperationId: (id: string) => Promise<string> = async (id) => id): ClusterReader {
  const get = (r: ClusterResource) => k8s.get(refFor(r), r.name, r.namespace || undefined, AbortSignal.timeout(15_000));
  const exact = async (r: ClusterResource) => { const live = await get(r); if (!live) throw notFound('资源', r.name); if (live.metadata.uid !== r.uid) throw conflict('资源已被同名新实例替换'); return live; };
  return {
    get,
    collect: (kind, namespace, selector, signal) => readCollection(k8s, Resources[kind]!, namespace, selector, signal),
    events: async (r) => {
      const result = await readCollection(k8s, Resources.Event!, r.namespace || undefined, undefined, AbortSignal.timeout(15_000), `involvedObject.uid=${r.uid}`);
      return { items: result.objects.filter((o) => objectRecord(o.involvedObject).uid === r.uid).slice(-200).map((o) => ({ uid: o.metadata.uid ?? '', type: String(o.type ?? 'Normal'), reason: String(o.reason ?? ''), message: String(o.message ?? ''), count: Number(o.count ?? 1), ...(o.lastTimestamp || o.eventTime ? { at: String(o.lastTimestamp ?? o.eventTime) } : {}) })) };
    },
    logs: async (r, query) => {
      if (r.kind !== 'Pod') throw precondition('仅 Pod 支持容器日志');
      const live = await exact(r), spec = objectRecord(live.spec);
      if (![...objectArray(spec.containers), ...objectArray(spec.initContainers)].some((c) => c.name === query.container)) throw precondition('容器不存在');
      const stream = await k8s.logs(r.namespace, r.name, { container: query.container, previous: query.previous === 'true', tailLines: query.tailLines, timestamps: true, signal: AbortSignal.timeout(20_000), ...(query.since ? { sinceSeconds: Math.max(1, Math.ceil((Date.now() - Date.parse(query.since)) / 1000)) } : {}) });
      const { text, truncated } = await boundedText(stream);
      await exact(r);
      return { uid: r.uid, container: query.container, previous: query.previous === 'true', text, truncated };
    },
    hasApplied: async (r, request, operationId) => {
      operationId = await physicalOperationId(operationId);
      const live = await get(r);
      if (request.action === 'delete') return !live || live.metadata.uid !== r.uid;
      if (live?.metadata.uid !== r.uid) return false;
      return objectRecord(objectRecord(objectRecord(objectRecord(live.spec).template).metadata).annotations)[restartKey] === operationId || live.metadata.annotations?.[restartKey] === operationId;
    },
    apply: async (r, request, operationId) => {
      operationId = await physicalOperationId(operationId);
      for (let attempt = 0; attempt < 3; attempt++) {
        const live = await exact(r);
        if (configRevision(live) !== r.revision) throw conflict('资源期望配置已变化，请重新检查');
        try {
          if (request.action === 'delete') { await k8s.delete(refFor(r), r.name, r.namespace || undefined, { propagationPolicy: 'Foreground', preconditions: { uid: r.uid, resourceVersion: live.metadata.resourceVersion! } }); return; }
          const patch: JsonPatch[] = [{ op: 'test', path: '/metadata/uid', value: r.uid }, { op: 'test', path: '/metadata/resourceVersion', value: live.metadata.resourceVersion }, { op: 'add', path: '/metadata/annotations', value: { ...live.metadata.annotations, [restartKey]: operationId } }];
          if (request.action === 'restart') patch.push({ op: 'add', path: '/spec/template/metadata/annotations', value: { ...objectRecord(objectRecord(objectRecord(objectRecord(live.spec).template).metadata).annotations), [restartKey]: operationId } });
          else patch.push({ op: 'add', path: '/spec/replicas', value: request.replicas });
          await k8s.jsonPatch(refFor(r), r.name, r.namespace || undefined, patch); return;
        } catch (error) { if (attempt === 2 || !(error instanceof Error) || !('kind' in error) || error.kind !== 'conflict') throw error; }
      }
    },
  };
}
async function readCollection(k8s: K8sClient, ref: ResourceRef, namespace: string | undefined, selector: string | undefined, signal: AbortSignal, fieldSelector?: string): Promise<{ objects: ResourceObject[]; resourceVersion: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const items = new Map<string, ResourceObject>(); let cursor = '', version = '', pages = 0;
      do {
        signal.throwIfAborted();
        const page = await k8s.listPage(ref, namespace, { limit: 500, continue: cursor, signal, ...(selector ? { labelSelector: selector } : {}), ...(fieldSelector ? { fieldSelector } : {}) });
        if (version && page.resourceVersion !== version) throw conflict('Kubernetes 分页版本发生变化');
        for (const item of page.items) if (item.metadata.uid) items.set(item.metadata.uid, item);
        version = page.resourceVersion; cursor = page.continue;
        if (++pages > 2000) throw precondition('资源分页超出本次采集上限');
      } while (cursor);
      return { objects: [...items.values()], resourceVersion: version };
    } catch (error) {
      if (attempt >= 1 || !error || typeof error !== 'object' || !('details' in error) || objectRecord(error.details).status !== 410) throw error;
    }
  }
}
async function boundedText(stream: ReadableStream<Uint8Array>): Promise<{ text: string; truncated: boolean }> {
  const reader = stream.getReader(), decoder = new TextDecoder(); let text = '', bytes = 0, truncated = false;
  try { for (;;) { const next = await reader.read(); if (next.done) break; const remaining = 2_000_000 - bytes; text += decoder.decode(next.value.slice(0, remaining), { stream: true }); bytes += next.value.length; if (bytes >= 2_000_000) { truncated = true; await reader.cancel(); break; } } } finally { reader.releaseLock(); }
  return { text: text + decoder.decode(), truncated };
}
