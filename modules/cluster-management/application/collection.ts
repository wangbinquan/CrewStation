import { resourceReferences } from './resourceReferences';
import { newResourceId } from '@crewstation/kernel';
import type { ClusterSource } from '@crewstation/contracts';
import type { InventorySnapshot, ResourceObject } from '../domain/inventory';
import { collectedKinds } from '../domain/inventory';
import { projectResources } from '../domain/projection';
import type { ClusterDeps } from './dependencies';

export async function collectSnapshot(deps: ClusterDeps, signal: AbortSignal): Promise<InventorySnapshot> {
  const startedAt = deps.clock.now().toISOString(), previous = await deps.repository.latest();
  let facts;
  try { facts = await deps.metadata.read(); } catch (error) { facts = { projects: previous?.facts.projects ?? [], tasks: previous?.facts.tasks ?? [], releases: previous?.facts.releases ?? [], retained: previous?.facts.retained ?? [], complete: false, reason: String(error) }; }
  const namespaces = [...new Set([deps.systemNamespace, ...facts.projects.map((p) => p.namespace)])];
  const jobs = collectedKinds.flatMap((kind) => kind === 'Namespace' ? [{ kind, namespace: '', selector: undefined as string | undefined }] : [...namespaces.map((namespace) => ({ kind, namespace, selector: undefined as string | undefined })), { kind, namespace: '', selector: 'app.kubernetes.io/managed-by=crewstation' }]);
  const objects: ResourceObject[] = [], sources: ClusterSource[] = [], stale = new Map<string, ClusterSource>();
  const one = async (source: typeof jobs[number]): Promise<void> => {
    const key = `${source.namespace || '*'}/${source.kind}`, old = previous?.sources.find((s) => s.key === key);
    try {
      const result = await deps.cluster.collect(source.kind, source.namespace || undefined, source.selector, AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
      objects.push(...result.objects.filter((o) => !source.selector || !namespaces.includes(o.metadata.namespace ?? '')));
      sources.push({ key, kind: source.kind, namespace: source.namespace, batchId: newResourceId(), observedAt: deps.clock.now().toISOString(), resourceVersion: result.resourceVersion, state: 'complete', count: result.objects.length });
    } catch (error) {
      signal.throwIfAborted();
      const unsupported = typeof error === 'object' && error !== null && 'kind' in error && error.kind === 'not_found';
      const failed: ClusterSource = { key, kind: source.kind, namespace: source.namespace, batchId: old?.batchId ?? '', resourceVersion: old?.resourceVersion ?? '', state: unsupported ? 'unsupported' : old?.observedAt ? 'stale' : 'error', count: old?.count ?? 0, reason: String(error), ...(old?.observedAt ? { observedAt: old.observedAt } : {}) };
      sources.push(failed); if (!unsupported) stale.set(key, failed);
    }
  };
  const lanes = Array.from({ length: 4 }, async () => { for (;;) { signal.throwIfAborted(); const job = jobs.shift(); if (!job) break; await one(job); } });
  await Promise.all(lanes); signal.throwIfAborted();
  const unique = [...new Map(objects.map((o) => [o.metadata.uid, o])).values()];
  const resources = await resourceReferences(deps, projectResources(unique, facts, deps.systemNamespace, deps.catalog, deps.clock.now().toISOString(), await deps.repository.resourceIds(unique.map((object) => object.metadata.uid!))));
  const seen = new Set(resources.map((r) => r.uid));
  for (const row of previous?.resources ?? []) if (!seen.has(row.uid) && (stale.has(`${row.namespace || '*'}/${row.kind}`) || !namespaces.includes(row.namespace) && stale.has(`*/${row.kind}`))) resources.push({ ...row, availableActions: row.availableActions.map((a) => ({ ...a, enabled: false, reason: '来源过期，请等待完整采集' })) });
  if (!facts.complete) sources.push({ key: 'platform-metadata', kind: 'Platform', namespace: '', batchId: '', resourceVersion: '', state: 'error', count: 0, reason: facts.reason ?? '平台资料读取失败' });
  const snapshot = { id: newResourceId(), startedAt, finishedAt: deps.clock.now().toISOString(), facts, sources: sources.sort((a, b) => a.key.localeCompare(b.key)), resources };
  await deps.repository.saveSnapshot(snapshot);
  return snapshot;
}
