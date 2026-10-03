import {installRuntimeCompleteFixture} from './runtimeCompleteFixture';
import { RUNTIME_IMAGES } from './computeProfileFixture';
import { RuntimeTaskObservationSchema, SystemRuntimeStatisticsSchema, ProjectRuntimeStatisticsSchema, RuntimeUsageMetricsSchema } from '@crewstation/contracts';
import { adminDirectoryFixture } from './adminDirectoryFixture';
export function runtimeStatisticsFixture() {
  const directory = adminDirectoryFixture({ count: 16 }), delegate = globalThis.fetch, projectId = directory.projects[12]!.project.id;
  const from = '2026-09-28T00:00:00.000Z', to = '2026-09-29T00:00:00.000Z';
  const metrics = RuntimeUsageMetricsSchema.parse({ tokens: { input: '80', output: '20', cacheRead: '0', cacheWrite: '0', total: '100', hasKnown: true, complete: true, unknownBuckets: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    cost: { currency: 'CNY', amount: '0.25', visible: true, complete: true }, executions: 1, observedExecutions: 1, records: 1, reasons: [], partial: false });
  const details = Array.from({ length: 24 }, (_, i) => { const id = Bun.randomUUIDv7(); return RuntimeTaskObservationSchema.parse({ id, projectId, serviceId: directory.projects[12]!.project.serviceId!, name: 'Task ' + i, projectName: directory.projects[12]!.project.name, protocol: 'v3', state: 'closed', createdAt: from, closedAt: '2026-09-28T00:00:20.000Z', traceId: null, attemptsPartial: false,
    attemptCount: 1, metrics, wallMs: 20000, cumulativeMs: 10000, activeUnionMs: 10000, unknownIntervals: 0, scope: 'system', asOf: to, partial: false,
    attempts: [{ id: Bun.randomUUIDv7(), taskId: id, executionId: Bun.randomUUIDv7(), agentId: Bun.randomUUIDv7(), profileId: Bun.randomUUIDv7(), profileRevision: 7, profileName: 'Compute ' + i, name: 'Agent ' + i, kind: 'agent', state: 'succeeded', attempt: 1, createdAt: from, startedAt: from, endedAt: '2026-09-28T00:00:10.000Z', metrics, durationMs: 10000, open: false }] }); });
  const sum = { ...metrics, tokens: { ...metrics.tokens, input: '1920', output: '480', total: '2400' }, cost: { ...metrics.cost, amount: '6' }, executions: 24, observedExecutions: 24, records: 24 };
  const tasks = details.map(({ attempts: _a, scope: _s, asOf: _at, partial: _p, ...task }) => task);
  const agents = details.map((task) => ({ key: task.attempts[0]!.agentId!, projectId, projectName: task.projectName, profileName: task.attempts[0]!.profileName, agentId: task.attempts[0]!.agentId, profileId: task.attempts[0]!.profileId, profileRevision: 7, kind: 'agent', name: task.attempts[0]!.name, metrics, tasks: [{ taskId: task.id, metrics, attempts: 1 }] }));
  const data = SystemRuntimeStatisticsSchema.parse({ asOf: to, projectionVersion: 1, cohort: 'started', filters: { from, to, timezone: 'Asia/Shanghai' }, partial: false, limits: { tasks: 200, attempts: 2000, records: 20000 },
    metrics: sum, tasks, agents, projects: [{ projectId, projectName: details[0]!.projectName, tasks: 24, metrics: sum }], trend: Array.from({ length: 24 }, (_, hour) => ({ from: new Date(Date.parse(from) + hour * 3600000).toISOString(), to: new Date(Date.parse(from) + (hour + 1) * 3600000).toISOString(), tasks: hour === 0 ? 24 : 0, metrics: hour === 0 ? sum : { ...metrics, tokens: { ...metrics.tokens, input: '0', output: '0', total: '0' }, cost: { ...metrics.cost, amount: '0' }, executions: 0, observedExecutions: 0, records: 0 } })), durations: { samples: 24, p50Ms: 20000, p95Ms: 20000, maxMs: 20000 }, quality: [{ reason: 'timing-missing', taskIds: [tasks[0]!.id] }], sourceScope: 'business-tasks', scope: 'system', models: [{ modelRef: 'actual-model-hash', metrics: sum }], profiles: agents.map((a) => ({ key: JSON.stringify([a.profileId, a.profileRevision]), profileId: a.profileId, profileName: a.profileName, profileRevision: a.profileRevision, metrics: a.metrics, tasks: a.tasks })) });
  data.tasks[0]!.metrics = { ...metrics, reasons: ['timing-missing'] };
  const state = { error: false, partial: false, empty: false }, reads: string[] = [];
  const hide = <T,>(input: T): T => JSON.parse(JSON.stringify(input), (key, value) => key === 'cost' ? { ...value, amount: null, visible: false, complete: false } : value) as T;
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'); if (url.pathname === '/v1/admin/runtime-images') return Response.json(RUNTIME_IMAGES);
    if (url.pathname.startsWith('/v1/admin/observability/pricing/')) return Response.json({ items: [] });
    if (!url.pathname.includes('/observability/')) return delegate(raw, init); reads.push(url.pathname + url.search);
    if ((init?.method ?? 'GET') !== 'GET') throw new Error('Unexpected observation mutation');
    if (state.error) return Response.json({ error: 'unavailable', message: 'Ledger temporarily unavailable', details: {} }, { status: 503 });
    const project = url.pathname.startsWith('/v1/projects/'), detail = url.pathname.split('/tasks/')[1];
    if (detail) { const value = details.find((task) => task.id === detail); return value ? Response.json(project ? hide({ ...value, scope: 'project' }) : value) : Response.json({ error: 'not_found', message: 'Task missing', details: {} }, { status: 404 }); }
    const q = url.searchParams.get('q'), status = url.searchParams.get('state'), quality = url.searchParams.get('quality');
    const tasks = state.empty ? [] : data.tasks.filter((task) => (!q || `${task.name} ${task.id} ${task.projectName ?? ''} ${task.projectId}`.toLowerCase().includes(q.toLowerCase())) && (!status || task.state === status) && (!quality || task.metrics.reasons.includes(quality)));
    const ids = new Set(tasks.map((task) => task.id)), agents = data.agents.filter((agent) => agent.tasks.some((task) => ids.has(task.taskId)));
    const filteredMetrics = { ...sum, tokens: { ...sum.tokens, input: String(tasks.length * 80), output: String(tasks.length * 20), total: String(tasks.length * 100) }, cost: { ...sum.cost, amount: String(tasks.length * .25) }, executions: tasks.length, observedExecutions: tasks.length, records: tasks.length };
    const value = { ...data, metrics: filteredMetrics, partial: state.partial, tasks, agents, filters: { ...data.filters, from: url.searchParams.get('from')!, to: url.searchParams.get('to')! } };
    if (!project) return Response.json(value);
    const { models: _m, ...common } = value; return Response.json(ProjectRuntimeStatisticsSchema.parse(hide({ ...common, scope: 'project', projectId })));
  }) as typeof fetch;
  installRuntimeCompleteFixture(()=>details,reads);
  return { projectId, from, to, data, details, metrics, state, reads, directory, query: `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` };
}
