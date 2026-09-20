import { ClusterResourceSchema, ClusterSummarySchema } from '@crewstation/contracts';
import type { ClusterInspection, ClusterOperation, ClusterResource, ClusterSummary } from '@crewstation/contracts';
export function clusterFixture(options: { admin?: boolean; loseReceipt?: boolean; partial?: boolean } = {}) {
  const calls: Array<{ path: string; method: string; body: Record<string, unknown>; query: URLSearchParams }> = [];
  const time = new Date().toISOString(), projectId = `prj_${'a'.repeat(32)}`;
  const row: ClusterResource = { resourceId: 'resource-uid', apiVersion: 'apps/v1', kind: 'Deployment', namespace: 'cs-cluster-demo', name: 'cluster-demo-green', uid: 'uid-original', resourceVersion: '1', revision: 'spec-1', observedAt: time, generation: 2, view: 'workloads', ownership: { scope: 'project', projectId, projectName: '集群验收', slug: 'cluster-demo', projectKind: 'DigitalWorker', archived: false }, purpose: 'digital-worker-service', phase: 'Active', ready: true, abnormal: false, reason: '', topLevel: true, standalone: false, desired: 1, actual: 1, readyReplicas: 1, restarts: 0, labels: {}, owners: [], references: [], containers: [{ name: 'main', init: false, image: 'worker:v1', state: 'running', ready: true, restarts: 0, requests: { cpu: '1' }, limits: { memory: '1Gi' }, ports: [3000] }], facts: {}, physicalSlot: 'green', slotRole: 'preview', availableActions: (['restart', 'scale', 'restore-replicas', 'delete'] as const).map((action) => ({ action, enabled: action !== 'delete', reason: action === 'delete' ? '工作卷仍被引用' : '', executionRoute: 'release', impactSummary: ['保留发布历史'], minReplicas: 1, maxReplicas: 3 })) };
  const summary: ClusterSummary = { snapshotId: 'snapshot-1', startedAt: time, finishedAt: time, complete: !options.partial, total: 250, workloads: 205, pods: 32, runningPods: 30, readyPods: 29, standalonePods: 6, services: 5, pvcs: 8, abnormal: 3, kinds: { Deployment: 205, Pod: 32 }, phases: { Running: 30 }, purposes: {}, projects: [{ id: projectId, name: '集群验收' }], sources: options.partial ? [{ key: 'cs-cluster-demo/Pod', kind: 'Pod', namespace: 'cs-cluster-demo', batchId: 'batch', resourceVersion: 'v1', state: 'stale', count: 32, observedAt: time, reason: '采集暂时不可达' }] : [] };
  ClusterResourceSchema.parse(row); ClusterSummarySchema.parse(summary);
  let inspection: ClusterInspection | undefined, operation: ClusterOperation | undefined;
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'), method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ path: url.pathname, method, body, query: url.searchParams }); let data: unknown = { items: [] }, status = 200;
    if (url.pathname === '/v1/me') data = { id: 'admin', name: '管理员', platformRole: options.admin === false ? 'developer' : 'admin', isAdmin: options.admin !== false, memberships: [] };
    else if (url.pathname.endsWith('/summary')) { if (url.searchParams.get('snapshotId') === 'expired') { status = 410; data = { error: 'not_found', message: '快照已过期，请刷新列表' }; } else data = summary; }
    else if (url.pathname.endsWith('/resources')) data = { snapshotId: summary.snapshotId, complete: summary.complete, items: [row], total: 205, ...(url.searchParams.has('cursor') ? {} : { nextCursor: 'cursor-2' }) };
    else if (url.pathname.endsWith('/inspect-operation')) { inspection = { inspectionId: 'inspection-1', expiresAt: new Date(Date.now() + 300_000).toISOString(), target: row, request: body as ClusterInspection['request'], capability: row.availableActions.find((a) => a.action === body.action)!, related: [{ name: 'pod-original', uid: 'pod-uid', kind: 'Pod' }] }; data = inspection; }
    else if (url.pathname.endsWith('/operations') && method === 'POST') {
      operation = { operationId: 'operation-stable', inspectionId: String(body.inspectionId), idempotencyKey: String(body.idempotencyKey), actorId: 'admin', action: inspection!.request.action, params: inspection!.request, target: row, phase: 'observing', createdAt: time, updatedAt: time, durationMs: 1234, traceId: 'trace-original', httpStatus: 202, reason: '等待新 Pod 就绪' }; data = operation; status = 202;
      if (options.loseReceipt) throw new Error('response lost');
    } else if (url.pathname.endsWith('/operations')) data = { items: operation ? [operation] : [] };
    else if (url.pathname.endsWith('/operation-stable/reconcile')) { operation = { ...operation!, phase: 'observing', reason: '继续核对中' }; data = operation; }
    else if (url.pathname.endsWith('/operation-stable')) data = operation;
    else if (url.pathname.endsWith('/events')) data = { items: [{ uid: 'event', type: 'Normal', reason: 'Started', message: '原 UID 事件', count: 1 }] };
    else if (url.pathname.endsWith('/logs')) data = { uid: row.uid, container: 'main', previous: url.searchParams.get('previous') === 'true', text: 'runtime output', truncated: false };
    else if (url.pathname.endsWith('/resource-uid')) data = { resource: row, related: [], complete: summary.complete, sources: summary.sources };
    else if (url.pathname.endsWith('/refresh')) data = { refreshId: 'refresh-1' };
    else if (url.pathname === '/v1/me/activity') data = { items: [] };
    else throw new Error(`Unconfigured cluster fixture: ${method} ${url.pathname}`);
    return Response.json(data, { status });
  }) as typeof fetch;
  return { calls, row, summary, projectId, attention: () => { if (operation) operation = { ...operation, phase: 'needs-attention', httpStatus: 504, reason: '等待期限已到' }; } };
}
