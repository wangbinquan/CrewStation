// RFC-034 v2：运行统计的假后端——按需聚合接口的真实 DTO（经 contracts schema 校验），项目接口按费用可见性隐藏人民币。
import {
  ObservationAgentPageSchema, ObservationModelPageSchema, ObservationOverviewSchema, ObservationPlatformPageSchema, ObservationProjectPageSchema,
  ObservationTaskDetailSchema, ObservationTaskPageSchema,
} from '@crewstation/contracts';
import type { ObservationCall, ObservationTaskRow, ObservationUsage, ProjectId } from '@crewstation/contracts';
import { adminDirectoryFixture } from './adminDirectoryFixture';
import { RUNTIME_IMAGES } from './computeProfileFixture';

export const ASOF = '2026-10-14T08:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(ASOF) - minutes * 60_000).toISOString();

export function usageOf(patch: Partial<ObservationUsage> = {}): ObservationUsage {
  return { calls: 1, incompleteCalls: 0, failedCalls: 0, input: 1000, cacheRead: 200, cacheWrite: 50, output: 300, reasoning: 40, costNano: '2500000000', unpricedCalls: 0, ...patch };
}

function callOf(id: string, patch: Partial<ObservationCall>): ObservationCall {
  return {
    id, source: 'business', kind: 'subtask', projectId: null, taskId: 'task-0', taskLabel: 'Task 0', subtaskId: 'subtask-1', attempt: 1,
    agentKey: 'coder', agentLabel: 'Coder', profileId: '01a0bf5d-8f4b-7a07-8000-000000000001', profileName: 'GLM 档位', profileRevision: 3, protocol: 'opencode',
    status: 'done', startedAt: at(60), endedAt: at(50), usageState: 'complete', costState: 'priced',
    input: 1000, cacheRead: 200, cacheWrite: 50, output: 300, reasoning: 40, costNano: '2500000000',
    models: [{ model: 'zhipu/glm-5', input: 1000, cacheRead: 200, cacheWrite: 50, output: 300, reasoning: 40, costNano: '2500000000' }], ...patch,
  };
}

/** task-0 有两个 Agent：Coder 第一次失败后重试成功；Reviewer 仍在运行且只有部分用量，其中一个模型未定价。 */
function taskCalls(projectId: ProjectId): ObservationCall[] {
  return [
    callOf('call-1', { projectId, status: 'failed', endedAt: at(55), usageState: 'partial', costState: 'priced' }),
    callOf('call-2', { projectId, attempt: 2, startedAt: at(54), endedAt: at(40) }),
    callOf('call-3', { projectId, agentKey: 'reviewer', agentLabel: 'Reviewer', attempt: 1, subtaskId: 'subtask-2', status: 'running', startedAt: at(39), endedAt: null,
      usageState: 'partial', costState: 'partial', input: 400, cacheRead: 0, cacheWrite: 0, output: 100, reasoning: 0, costNano: '1000000000',
      models: [{ model: 'zhipu/glm-5', input: 300, cacheRead: 0, cacheWrite: 0, output: 80, reasoning: 0, costNano: '1000000000' },
        { model: 'other/unpriced', input: 100, cacheRead: 0, cacheWrite: 0, output: 20, reasoning: 0, costNano: null }] }),
  ];
}

function taskRows(projectId: ProjectId): ObservationTaskRow[] {
  return Array.from({ length: 30 }, (_, i) => ({
    taskId: `task-${i}`, source: i % 3 === 2 ? 'development' : 'business', label: `Task ${i}`, projectId, firstStartedAt: at(60 + i), lastEndedAt: i === 0 ? null : at(30 + i),
    running: i === 0, agents: 2, usage: usageOf({ calls: 2, ...(i === 0 ? { incompleteCalls: 2, failedCalls: 1, unpricedCalls: 1 } : {}) }),
  }));
}

/** 隐藏人民币：项目未开放费用可见性时项目接口返回的形状。 */
function hideCost<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (key, field: unknown) => (key === 'costNano' ? null : key === 'costVisible' ? false : field)) as T;
}

export function runtimeStatisticsFixture() {
  const directory = adminDirectoryFixture({ count: 16 }), delegate = globalThis.fetch, projectId = directory.projects[12]!.project.id;
  const state = { projectCostVisible: false, error: false }, reads: URL[] = [];
  const tasks = taskRows(projectId), calls = taskCalls(projectId);
  const overview = ObservationOverviewSchema.parse({
    asOf: ASOF, from: at(7 * 1440), to: ASOF, costVisible: true,
    usage: usageOf({ calls: 60, incompleteCalls: 2, failedCalls: 1, unpricedCalls: 1, input: 60_000, cacheRead: 12_000, cacheWrite: 3_000, output: 18_000, reasoning: 2_400, costNano: '150000000000' }),
    bySource: { business: usageOf({ calls: 40 }), development: usageOf({ calls: 18, incompleteCalls: 2 }), platform: usageOf({ calls: 2, unpricedCalls: 2, costNano: '0' }) },
    statuses: { running: 1, done: 56, failed: 2, canceled: 0, interrupted: 1 },
    durations: { samples: 59, p50: 42_000, p95: 610_000, max: 1_800_000 },
    // 10-13 只有未定价的执行（人民币为「未定价」不是 ¥0）；10-14 含不完整与未定价的执行（下界）。
    daily: Array.from({ length: 8 }, (_, i) => ({ day: `2026-10-${String(7 + i).padStart(2, '0')}`, calls: i === 7 ? 60 : i === 6 ? 2 : 0,
      incompleteCalls: i === 7 ? 2 : 0, unpricedCalls: i === 7 ? 1 : i === 6 ? 2 : 0, input: i === 7 ? 60_000 : i === 6 ? 1_000 : 0,
      cacheRead: i === 7 ? 12_000 : 0, cacheWrite: i === 7 ? 3_000 : 0, output: i === 7 ? 18_000 : i === 6 ? 200 : 0, costNano: i === 7 ? '150000000000' : '0' })),
    topTasks: tasks.slice(0, 3).map((row) => ({ taskId: row.taskId, source: row.source, label: row.label, projectId, usage: row.usage })),
    topAgents: [{ agentKey: 'coder', agentLabel: 'Coder', tasks: 20, durationMs: 3_600_000, usage: usageOf({ calls: 40 }) }],
    topProjects: [{ projectId, projectName: '管理项目 12', tasks: 30, usage: usageOf({ calls: 60 }) }],
  });
  const platform = ObservationPlatformPageSchema.parse({
    asOf: ASOF, kinds: [{ kind: 'profile-test', usage: usageOf({ calls: 2, unpricedCalls: 2, costNano: '0' }) }], nextCursor: null,
    recent: [callOf('call-p', { source: 'platform', kind: 'profile-test', projectId: null, taskId: 'test-1', taskLabel: 'GLM 档位 · r3', subtaskId: null, attempt: null,
      agentKey: 'profile-test:protocol', agentLabel: '协议轮次', profileId: 'builtin:opencode', profileName: null, profileRevision: null, costState: 'unpriced', costNano: '0',
      models: [{ model: 'zhipu/glm-5', input: 1000, cacheRead: 200, cacheWrite: 50, output: 300, reasoning: 40, costNano: null }] })],
  });
  const respond = (url: URL): unknown => {
    const project = url.pathname.startsWith('/v1/projects/'), path = url.pathname.replace(/^\/v1\/(projects\/[^/]+|admin)\/observability/, '');
    const visible = !project || state.projectCostVisible, scoped = <T,>(value: T) => (visible ? value : hideCost(value));
    if (path === '/overview') return scoped(project ? { ...overview, costVisible: visible, topProjects: [] } : overview);
    if (path === '/tasks') {
      const q = url.searchParams.get('q'), source = url.searchParams.get('source'), offset = url.searchParams.get('cursor') === 'page-2' ? 25 : 0;
      const rows = tasks.filter((row) => (!q || `${row.label} ${row.taskId}`.includes(q)) && (!source || row.source === source));
      return scoped(ObservationTaskPageSchema.parse({ asOf: ASOF, costVisible: visible, items: rows.slice(offset, offset + 25), nextCursor: offset === 0 && rows.length > 25 ? 'page-2' : null }));
    }
    const detail = /^\/tasks\/(.+)$/.exec(path)?.[1];
    if (detail) return scoped(ObservationTaskDetailSchema.parse({ asOf: ASOF, costVisible: visible, task: { taskId: detail, source: 'business', label: tasks.find((row) => row.taskId === detail)?.label ?? detail, projectId },
      usage: usageOf({ calls: 3, incompleteCalls: 2, failedCalls: 1, unpricedCalls: 0, input: 2400, cacheRead: 400, cacheWrite: 100, output: 700, reasoning: 80, costNano: '6000000000' }),
      calls: calls.map((call) => ({ ...call, taskId: detail })), truncated: false }));
    if (path === '/agents') return scoped(ObservationAgentPageSchema.parse({ asOf: ASOF, costVisible: visible, truncated: false, items: overview.topAgents }));
    if (path === '/models') return scoped(ObservationModelPageSchema.parse({ asOf: ASOF, costVisible: visible, truncated: false, items: [
      { profileId: '01a0bf5d-8f4b-7a07-8000-000000000001', profileName: 'GLM 档位', protocol: 'opencode', model: 'zhipu/glm-5', usage: usageOf({ calls: 50 }) },
      { profileId: 'builtin:opencode', profileName: null, protocol: 'opencode', model: 'other/unpriced', usage: usageOf({ calls: 3, unpricedCalls: 3, costNano: '0' }) },
    ] }));
    if (path === '/projects') return ObservationProjectPageSchema.parse({ asOf: ASOF, costVisible: true, truncated: false, items: overview.topProjects });
    if (path === '/platform') return platform;
    return undefined;
  };
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost');
    if (url.pathname === '/v1/admin/runtime-images') return Response.json(RUNTIME_IMAGES);
    if (!url.pathname.includes('/observability/') || url.pathname.includes('/pricing') || url.pathname.includes('/cost-visibility') || url.pathname.endsWith('/telemetry')) return delegate(raw, init);
    if ((init?.method ?? 'GET') !== 'GET') throw new Error('Unexpected observation mutation');
    reads.push(url);
    if (state.error) return Response.json({ error: 'unavailable', message: 'Statistics temporarily unavailable', details: {} }, { status: 503 });
    const body = respond(url);
    return body === undefined ? Response.json({ error: 'not_found', message: 'unknown observation path', details: {} }, { status: 404 }) : Response.json(body);
  }) as typeof fetch;
  return { projectId, state, reads, tasks, calls };
}
