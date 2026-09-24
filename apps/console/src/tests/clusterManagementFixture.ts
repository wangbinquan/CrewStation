import { ClusterResourceSchema, ClusterSummarySchema } from '@crewstation/contracts';
import type { ClusterInspection, ClusterOperation, ClusterResource, ClusterSummary, ResourceRecord } from '@crewstation/contracts';
export function clusterFixture(options: { admin?: boolean; loseReceipt?: boolean; partial?: boolean } = {}) {
  const calls: Array<{ path: string; method: string; body: Record<string, unknown>; query: URLSearchParams }> = [];
  const time = new Date().toISOString(), projectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34';
  const row: ClusterResource = { resourceId: 'resource-uid', apiVersion: 'apps/v1', kind: 'Deployment', namespace: 'cs-cluster-demo', name: 'cluster-demo-green', uid: 'uid-original', resourceVersion: '1', revision: 'spec-1', observedAt: time, generation: 2, view: 'workloads', ownership: { scope: 'project', projectId, projectName: '集群验收', slug: 'cluster-demo', projectKind: 'DigitalWorker', archived: false }, purpose: 'digital-worker-service', phase: 'Active', ready: true, abnormal: false, reason: '', topLevel: true, standalone: false, desired: 1, actual: 1, readyReplicas: 1, restarts: 0, labels: {}, owners: [], references: [], containers: [{ name: 'main', init: false, image: 'worker:v1', state: 'running', ready: true, restarts: 0, requests: { cpu: '1' }, limits: { memory: '1Gi' }, ports: [3000] }], facts: {}, physicalSlot: 'green', slotRole: 'preview', availableActions: (['restart', 'scale', 'restore-replicas', 'delete'] as const).map((action) => ({ action, enabled: action !== 'delete', reason: action === 'delete' ? '工作卷仍被引用' : '', executionRoute: 'release', impactSummary: ['保留发布历史'], minReplicas: 1, maxReplicas: 3 })) };
  let summary: ClusterSummary = { snapshotId: 'snapshot-1', startedAt: time, finishedAt: time, complete: !options.partial, total: 250, workloads: 205, pods: 32, runningPods: 30, readyPods: 29, standalonePods: 6, services: 5, pvcs: 8, abnormal: 3, kinds: { Deployment: 205, Pod: 32 }, phases: { Running: 30 }, purposes: {}, projects: [{ id: projectId, name: '集群验收', ...(options.partial ? {} : { workloads: 1, pods: 1, readyPods: 1, abnormal: 0, devSessions: 0 }) }], sources: options.partial ? [{ key: 'cs-cluster-demo/Pod', kind: 'Pod', namespace: 'cs-cluster-demo', batchId: 'batch', resourceVersion: 'v1', state: 'stale', count: 32, observedAt: time, reason: '采集暂时不可达' }] : [] };
  ClusterResourceSchema.parse(row); ClusterSummarySchema.parse(summary);
  let inspection: ClusterInspection | undefined, operation: ClusterOperation | undefined;
  // RFC-025 T13：「待回收的工作卷」读资源中心的全平台视图，记录操作经资源中心受理（202，受理后这项操作不再可做）；用例往 records 里放记录。
  const records: ResourceRecord[] = [];
  // 过期（410）的快照：摘要与资源清单按它读取都得到 410。
  const expired = new Set(['expired']);
  // 保留回执不返回，用来断言换快照在途时页面上还剩什么。
  let held: Promise<void> | undefined, heldPaths: readonly string[] = [];
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'), method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ path: url.pathname, method, body, query: url.searchParams }); let data: unknown = { items: [] }, status = 200;
    if (url.pathname === '/v1/me') data = { id: 'admin', name: '管理员', platformRole: options.admin === false ? 'developer' : 'admin', isAdmin: options.admin !== false, memberships: [] };
    else if (url.pathname === '/v1/admin/resources') data = { items: records, counts: {}, cursor: 1 };
    else if (url.pathname.startsWith('/v1/resources/') && method === 'POST') {
      const [, , , id, , action] = url.pathname.split('/'), at = records.findIndex((r) => r.id === id);
      if (at >= 0) records[at] = { ...records[at]!, version: records[at]!.version + 1, actions: records[at]!.actions.map((a) => a.id === action ? { id: a.id, enabled: false, disabledReason: '已受理删除，正在回收' } : a) };
      data = { accepted: true, ...(at >= 0 ? { record: records[at] } : {}) }; status = 202;
    }
    else if (url.pathname.endsWith('/summary') || url.pathname.endsWith('/resources') && expired.has(url.searchParams.get('snapshotId') ?? '')) { if (expired.has(url.searchParams.get('snapshotId') ?? '')) { status = 410; data = { error: 'not_found', message: '快照已过期，请刷新列表' }; } else data = summary; }
    else if (url.pathname.endsWith('/resources') && url.searchParams.get('scope') === 'system') data = { snapshotId: summary.snapshotId, complete: summary.complete, items: [{ ...row, resourceId: 'system-api', uid: 'uid-cs-api', name: 'cs-api', namespace: 'crewstation-system', ownership: { scope: 'system', component: 'cs-api' }, purpose: 'platform-service', slotRole: undefined, physicalSlot: undefined }], total: 1 };
    else if (url.pathname.endsWith('/resources') && url.searchParams.get('scope') === 'project' && url.searchParams.get('limit') === '100') data = { snapshotId: summary.snapshotId, complete: summary.complete, items: [row], total: 1 };
    else if (url.pathname.endsWith('/resources')) data = { snapshotId: summary.snapshotId, complete: summary.complete, items: [row], total: 205, ...(url.searchParams.has('cursor') ? {} : { nextCursor: 'cursor-2' }) };
    else if (url.pathname === `/v1/projects/${projectId}`) data = { id: projectId, slug: 'cluster-demo', name: '集群验收', kind: 'DigitalWorker', namespace: 'cs-cluster-demo', ownerUserId: '01a0bf5d-8f4b-7f8b-8136-e631380738b0', state: 'active', serviceId: '01a0bf5d-8f4b-7a02-8000-000000000001', createdAt: time };
    else if (url.pathname.endsWith('/slots')) data = { items: [{ name: 'prod', active: true, tag: 'v1.0.0', commitSha: 'a'.repeat(40), replicas: 1, readyReplicas: 1, state: 'ready', host: 'cluster-demo.cs.localhost' }, { name: 'preview', active: false, tag: 'v1.0.1', commitSha: 'b'.repeat(40), replicas: 1, readyReplicas: 1, state: 'ready', host: 'preview.cluster-demo.cs.localhost' }] };
    else if (url.pathname.endsWith('/dev-session')) { status = 404; data = { error: 'not_found', message: '没有开发会话' }; }
    else if (url.pathname.endsWith('/data/resources')) data = { items: [{ id: 'data-1', projectId, kind: 'postgres', env: 'production', plan: 'db-small', state: 'ready', envVar: 'CS_DATABASE_URL', createdAt: time }] };
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
    else if (url.pathname.endsWith('/system-api')) data = { resource: { ...row, resourceId: 'system-api', uid: 'uid-cs-api', name: 'cs-api', namespace: 'crewstation-system', ownership: { scope: 'system', component: 'cs-api' }, purpose: 'platform-service', slotRole: undefined, physicalSlot: undefined }, related: [], complete: summary.complete, sources: summary.sources };
    else if (url.pathname.endsWith('/refresh')) data = { refreshId: 'refresh-1' };
    else if (url.pathname === '/v1/me/activity') data = { items: [] };
    else throw new Error(`Unconfigured cluster fixture: ${method} ${url.pathname}`);
    if (held && heldPaths.some((path) => url.pathname.endsWith(path))) await held;
    return Response.json(data, { status });
  }) as typeof fetch;
  // summary 是初始快照的取值；newSnapshot 之后由服务端回执反映新的 snapshotId。
  return { calls, row, projectId, summary, records,
    /** 后台采集换了一份快照：下一次摘要读取给出新的 snapshotId。 */
    newSnapshot: (snapshotId: string) => { summary = { ...summary, snapshotId }; },
    /** 快照过了保留期：之后按它读取摘要或资源清单都得到 410。 */
    expire: (snapshotId: string) => { expired.add(snapshotId); },
    /** 扣住给定路径的回执，返回放行函数。 */
    hold: (...paths: readonly string[]) => { let open = () => {}; heldPaths = paths; held = new Promise<void>((resolve) => { open = () => { held = undefined; heldPaths = []; resolve(); }; }); return open; },
    attention: () => { if (operation) operation = { ...operation, phase: 'needs-attention', httpStatus: 504, reason: '等待期限已到' }; } };
}
