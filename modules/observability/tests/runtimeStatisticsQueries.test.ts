// RFC-034 v2 §5：统计在请求时对执行记录做窗口过滤 + GROUP BY——来源 / 状态 / 时长 / 连续日桶 / 排行、任务键集分页、
// 任务详情、Agent 与模型、项目与平台执行；项目页先按 view 授权且人民币随费用可见性，系统页仅管理员。真实 PostgreSQL。
import { afterEach, describe, expect, test } from 'bun:test';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { AgentCallStart } from '../api/agentCalls';
import { ADMIN, MEMBER, PROFILE, PROJECT_A, PROJECT_B, STRANGER, T0, agentCallFixture, dropFixtures, minutes, snapshot, start, windowOf } from './agentCallFixture';

const available = await testDatabaseAvailable();
afterEach(dropFixtures);
type Fixture = Awaited<ReturnType<typeof agentCallFixture>>;
const DAY = windowOf(0, 24 * 60);

async function run(f: Fixture, call: AgentCallStart, end: { status: 'done' | 'failed'; at: number; usage: Parameters<typeof snapshot> } | null) {
  await f.recorder.accept(call);
  if (end) await f.recorder.finish(call, { status: end.status, at: minutes(end.at), snapshot: snapshot(...end.usage) });
}

/** 项目 A：业务任务两次尝试（第一次失败）+ 一个开发 Agent（部分用量）+ 一个运行中的任务；项目 B 一个任务；一次平台档位测试；窗口外一次旧执行。 */
async function seed(f: Fixture) {
  f.clock.at = T0 - 60_000;
  await f.api.savePrice(ADMIN, PROFILE, { model: 'zhipu/glm-5', rates: { input: '2', cacheRead: '0.5', cacheWrite: null, output: '8' }, effectiveFrom: new Date(T0 - 3_600_000).toISOString(), note: '', expectedLatestId: null });
  f.clock.at = T0 + 2 * 24 * 3_600_000;
  const login = { taskId: 'task-a1', taskLabel: 'Fix login' };
  await run(f, start({ ...login, startedAt: minutes(10) }), { status: 'failed', at: 15, usage: ['complete', [{ model: 'zhipu/glm-5', input: 100, output: 10 }]] });
  await run(f, start({ ...login, attempt: 2, startedAt: minutes(16) }), { status: 'done', at: 26, usage: ['complete', [{ model: 'zhipu/glm-5', input: 200, cacheRead: 50, output: 30, reasoning: 5 }]] });
  await run(f, start({ source: 'development', kind: 'agent', taskId: 'session-1', taskLabel: 'main', subtaskId: null, attempt: null, agentKey: 'agent:glm', agentLabel: 'Agent · GLM', startedAt: minutes(30) }),
    { status: 'done', at: 40, usage: ['partial', [{ model: 'zhipu/glm-5', input: 50 }]] });
  await run(f, start({ projectId: PROJECT_B, taskId: 'task-b1', taskLabel: 'Bill', startedAt: minutes(50) }), { status: 'done', at: 52, usage: ['complete', [{ model: 'zhipu/glm-5', input: 1000 }]] });
  await run(f, start({ projectId: null, source: 'platform', kind: 'profile-test', taskId: 'test-1', taskLabel: 'GLM 档位 · r3', subtaskId: null, attempt: null, agentKey: 'profile-test:protocol',
    agentLabel: '协议轮次', profile: null, startedAt: minutes(60) }), { status: 'done', at: 61, usage: ['complete', [{ model: 'other/unpriced', input: 7 }]] });
  await run(f, start({ taskId: 'task-old', taskLabel: 'Old', startedAt: minutes(-2000) }), { status: 'done', at: -1990, usage: ['complete', [{ model: 'zhipu/glm-5', input: 5 }]] });
  await run(f, start({ taskId: 'task-a2', taskLabel: 'Running', startedAt: minutes(70) }), null);
}

describe.skipIf(!available)('RFC-034 v2 runtime statistics queries', () => {
  test('system overview aggregates the window by source, status, duration, day and ranking', async () => {
    const f = await agentCallFixture(); await seed(f);
    const overview = await f.api.overview(ADMIN, null, DAY);
    expect(overview.costVisible).toBe(true);
    expect(overview.usage).toMatchObject({ calls: 6, incompleteCalls: 2, failedCalls: 1, input: 1357, cacheRead: 50, output: 40, reasoning: 5, unpricedCalls: 1, costNano: '3045000' });
    expect([overview.bySource.business.calls, overview.bySource.development.calls, overview.bySource.platform.calls]).toEqual([4, 1, 1]);
    expect(overview.statuses).toEqual({ running: 1, done: 4, failed: 1, canceled: 0, interrupted: 0 });
    expect(overview.durations).toEqual({ samples: 5, p50: 300_000, p95: 600_000, max: 600_000 });
    expect(overview.daily.map((day) => [day.day, day.calls])).toEqual([['2026-10-14', 6]]);
    expect(overview.topTasks.map((row) => row.taskId)).toEqual(['task-b1', 'task-a1', 'session-1', 'test-1', 'task-a2']);
    expect(overview.topProjects.map((row) => [row.projectName, row.tasks])).toEqual([['Project B', 1], ['Project A', 3]]);
    const shifted = await f.api.overview(ADMIN, null, windowOf(0, 24 * 60, 480));
    expect(shifted.daily.map((day) => day.day)).toEqual(['2026-10-14', '2026-10-15']);
  });

  test('project pages authorize view, only see their own runs and hide CNY until cost visibility is opened', async () => {
    const f = await agentCallFixture(); await seed(f);
    const hidden = await f.api.overview(MEMBER, PROJECT_A, DAY);
    expect(f.authorized).toContainEqual([MEMBER.userId, PROJECT_A, 'view']);
    expect(hidden).toMatchObject({ costVisible: false, topProjects: [], usage: { calls: 4, costNano: null }, bySource: { platform: { calls: 0 } } });
    expect((await f.api.tasks(MEMBER, PROJECT_A, DAY)).items.every((row) => row.usage.costNano === null)).toBe(true);
    await expect(f.api.overview(STRANGER, PROJECT_A, DAY)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.api.overview(MEMBER, null, DAY)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.api.projects(MEMBER, DAY)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.api.platform(MEMBER, DAY)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.api.task(MEMBER, PROJECT_A, 'task-b1')).rejects.toMatchObject({ kind: 'not_found' });
    await f.api.setCostVisibility(ADMIN, PROJECT_A, { visible: true });
    expect((await f.api.overview(MEMBER, PROJECT_A, DAY)).usage.costNano).toBe('1045000');
  });

  test('tasks page newest first by keyset, filter by keyword and source, and reject a forged cursor', async () => {
    const f = await agentCallFixture(); await seed(f);
    for (let i = 0; i < 26; i++) await f.recorder.accept(start({ taskId: `bulk-${String(i).padStart(2, '0')}`, taskLabel: `Bulk ${i}`, startedAt: minutes(100 + i) }));
    const first = await f.api.tasks(ADMIN, null, DAY);
    expect(first.items).toHaveLength(25); expect(first.items[0]!.taskId).toBe('bulk-25'); expect(first.nextCursor).not.toBeNull();
    const second = await f.api.tasks(ADMIN, null, { ...DAY, cursor: first.nextCursor! });
    expect(second.items.map((row) => row.taskId)).toEqual(['bulk-00', 'task-a2', 'test-1', 'task-b1', 'session-1', 'task-a1']); expect(second.nextCursor).toBeNull();
    expect((await f.api.tasks(ADMIN, null, { ...DAY, q: 'login' })).items.map((row) => [row.taskId, row.agents, row.running])).toEqual([['task-a1', 1, false]]);
    expect((await f.api.tasks(ADMIN, null, { ...DAY, q: 'task-b1' })).items.map((row) => row.label)).toEqual(['Bill']);
    expect((await f.api.tasks(ADMIN, null, { ...DAY, source: 'development' })).items.map((row) => row.taskId)).toEqual(['session-1']);
    await expect(f.api.tasks(ADMIN, null, { ...DAY, cursor: 'forged' })).rejects.toMatchObject({ kind: 'validation' });
  });

  test('task detail, Agents, models, projects and platform runs', async () => {
    const f = await agentCallFixture(); await seed(f);
    const detail = await f.api.task(ADMIN, null, 'task-a1');
    expect(detail.calls.map((call) => [call.attempt, call.status, call.costNano])).toEqual([[1, 'failed', '280000'], [2, 'done', '665000']]);
    expect(detail.usage).toMatchObject({ calls: 2, failedCalls: 1, costNano: '945000' });
    const agents = await f.api.agents(ADMIN, null, DAY);
    expect(agents.items.map((row) => [row.agentKey, row.tasks, row.usage.calls])).toEqual([['coder', 3, 4], ['agent:glm', 1, 1], ['profile-test:protocol', 1, 1]]);
    const models = await f.api.models(ADMIN, null, DAY);
    expect(models.items.map((row) => [row.profileId, row.model, row.usage.calls, row.usage.unpricedCalls])).toEqual([[PROFILE, 'zhipu/glm-5', 4, 0], ['builtin:opencode', 'other/unpriced', 1, 1]]);
    expect((await f.api.projects(ADMIN, DAY)).items.map((row) => row.projectId)).toEqual([PROJECT_B, PROJECT_A]);
    const platform = await f.api.platform(ADMIN, DAY);
    expect(platform.kinds.map((row) => [row.kind, row.usage.calls, row.usage.unpricedCalls])).toEqual([['profile-test', 1, 1]]);
    expect(platform.recent.map((call) => [call.taskId, call.projectId, call.costState])).toEqual([['test-1', null, 'unpriced']]);
  });

  test('HTTP: project and system paths share the queries, windows are validated and the system path is admin-only', async () => {
    const f = await agentCallFixture(); await seed(f);
    const server = createApp({ name: 'runtime-statistics' });
    for (const routes of f.http) server.route('/', routes);
    const as = (actor: { userId: string }) => ({ headers: { [IDENTITY_HEADERS.userId]: actor.userId } });
    const window = `from=${encodeURIComponent(DAY.from)}&to=${encodeURIComponent(DAY.to)}&tzOffset=480`;
    const project = await server.request(`/v1/projects/${PROJECT_A}/observability/overview?${window}`, as(MEMBER));
    expect(project.status).toBe(200); expect(((await project.json()) as { usage: { calls: number } }).usage.calls).toBe(4);
    expect((await server.request(`/v1/admin/observability/overview?${window}`, as(MEMBER))).status).toBe(403);
    expect((await server.request(`/v1/admin/observability/overview?${window}`, as(ADMIN))).status).toBe(200);
    expect((await server.request(`/v1/admin/observability/overview?from=${encodeURIComponent(DAY.to)}&to=${encodeURIComponent(DAY.from)}`, as(ADMIN))).status).toBe(400);
    expect((await server.request(`/v1/admin/observability/tasks?${window}&cursor=forged`, as(ADMIN))).status).toBe(400);
    expect((await server.request(`/v1/admin/observability/tasks/task-a1`, as(ADMIN))).status).toBe(200);
    expect((await server.request(`/v1/admin/observability/pricing`, as(MEMBER))).status).toBe(403);
  });
});
