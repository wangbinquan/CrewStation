import { describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, RunnerEvent, TaskId, TraceListQuery, TraceSummaryDto, UserId } from '@crewstation/contracts';
import { TraceListQuerySchema } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import { traceChainUseCases } from '../application/traceChains';
import type { TraceBusinessTaskPart, TraceDeliveryPart, TraceEnvironmentPart, TraceKey, TraceStoredEvent } from '../domain/traceParts';
import type { TraceChainSources, TraceKeyPage } from '../ports/traceSources';

const project = '01a0bf5d-8f4b-7c01-82e1-9a99060b1192' as ProjectId, other = '01a0bf5d-8f4b-7c02-82e1-9a99060b1192' as ProjectId;
const actor: Actor = { userId: '01a0bf5d-8f4b-7c03-867c-efd7527b386b' as UserId, isAdmin: false };
const NOW = Date.UTC(2026, 8, 23, 12, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const trace = (n: number) => n.toString(16).padStart(32, '0');
const taskId = (n: number) => `01a0bf5d-8f4b-7${(n % 1000).toString().padStart(3, '0')}-8b88-${n.toString().padStart(12, '0')}` as TaskId;

type Owned<T> = T & { readonly projectId: ProjectId };
interface World { environments: Owned<TraceEnvironmentPart>[]; deliveries: Owned<TraceDeliveryPart>[]; businessTasks: Owned<TraceBusinessTaskPart>[]; events: Map<string, TraceStoredEvent[]> }

/** 与两个 SQL 查询同义：按项目、按 traceId 分组，开始时间取最早、活动取最晚，按 (开始时间, traceId) 倒序翻页。 */
function keysOf(rows: Array<{ projectId: ProjectId; traceId: string; createdAt: string; last: string; active: boolean }>, projectId: ProjectId, page: TraceKeyPage): TraceKey[] {
  const groups = new Map<string, TraceKey>();
  for (const r of rows.filter((row) => row.projectId === projectId)) {
    const g = groups.get(r.traceId);
    groups.set(r.traceId, g ? { traceId: r.traceId, firstAt: g.firstAt < r.createdAt ? g.firstAt : r.createdAt, lastAt: g.lastAt > r.last ? g.lastAt : r.last, active: g.active || r.active }
      : { traceId: r.traceId, firstAt: r.createdAt, lastAt: r.last, active: r.active });
  }
  const before = page.before;
  return [...groups.values()].sort((a, b) => (a.firstAt === b.firstAt ? (a.traceId < b.traceId ? 1 : -1) : a.firstAt < b.firstAt ? 1 : -1))
    .filter((k) => !before || k.firstAt < before.at || (k.firstAt === before.at && k.traceId < before.traceId)).slice(0, page.limit);
}

function sources(world: World, calls: string[] = []): TraceChainSources {
  const envRows = () => world.environments.filter((e) => e.kind !== 'profile-test').map((e) => ({ ...e, last: e.updatedAt > e.lastActivityAt ? e.updatedAt : e.lastActivityAt, active: ['creating', 'running', 'paused', 'releasing'].includes(e.state) }));
  const deliveryRows = () => world.deliveries.map((d) => ({ ...d, last: d.updatedAt, active: ['pending', 'delivering', 'retrying', 'held'].includes(d.state) }));
  const active = (rows: Array<{ projectId: ProjectId; traceId: string; last: string; active: boolean }>, projectId: ProjectId, since: string) => [...new Set(rows.filter((r) => r.projectId === projectId && (r.active || r.last >= since)).map((r) => String(r.traceId)))];
  const inProject = <T extends { projectId: ProjectId; traceId: string }>(rows: T[], projectId: ProjectId, ids: readonly string[]) => rows.filter((r) => r.projectId === projectId && ids.includes(r.traceId));
  return {
    environments: {
      traceKeys: async (projectId, page) => { calls.push('env.keys'); return keysOf(envRows(), projectId, page); },
      activeTraceIds: async (projectId, since) => active(envRows(), projectId, since),
      list: async (projectId, ids) => inProject(world.environments.filter((e) => e.kind !== 'profile-test'), projectId, ids),
    },
    deliveries: {
      traceKeys: async (projectId, page) => { calls.push('delivery.keys'); return keysOf(deliveryRows(), projectId, page); },
      activeTraceIds: async (projectId, since) => active(deliveryRows(), projectId, since),
      list: async (projectId, ids) => inProject(world.deliveries, projectId, ids),
    },
    businessTasks: { list: async (projectId, ids) => inProject(world.businessTasks, projectId, ids) },
    sessions: {
      summarize: async (ids) => ids.flatMap((id) => (world.events.get(id)?.length ? [{ taskId: id, events: world.events.get(id)!.length, sessionIds: ['ses_1'], protocol: 'opencode' }] : [])),
      events: async (id, page) => (world.events.get(id) ?? []).filter((e) => e.seq > page.afterSeq && page.kinds.includes(e.event.kind)).slice(0, page.limit),
    },
  };
}

const env = (n: number, traceNo: number, minute: number, extra: Partial<Owned<TraceEnvironmentPart>> = {}): Owned<TraceEnvironmentPart> => ({
  id: taskId(n), projectId: project, traceId: trace(traceNo), kind: 'dev-session', state: 'released', createdAt: iso(NOW - minute * 60_000),
  updatedAt: iso(NOW - minute * 60_000 + 30_000), lastActivityAt: iso(NOW - minute * 60_000 + 20_000), ...extra,
});
const delivery = (traceNo: number, minute: number, extra: Partial<Owned<TraceDeliveryPart>> = {}): Owned<TraceDeliveryPart> => ({
  id: `d-${traceNo}-${minute}`, eventId: taskId(9000 + traceNo), projectId: project, traceId: trace(traceNo), eventType: 'gitlab.push', state: 'delivered', attempts: 1,
  createdAt: iso(NOW - minute * 60_000), updatedAt: iso(NOW - minute * 60_000 + 1000), ...extra,
});

/** 60 条链：事件触发业务任务的（投递先于任务几秒）、只有投递的、开发会话；再加别的项目里共用 traceId 的记录与同一毫秒开始的两条。 */
function busyWorld(): World {
  const world: World = { environments: [], deliveries: [], businessTasks: [], events: new Map() };
  for (let i = 1; i <= 60; i++) {
    const minute = 600 - i * 9;
    if (i % 3 === 0) {
      world.deliveries.push(delivery(i, minute));
      world.environments.push(env(i, i, minute - 0.05, { kind: 'business' }));
      world.businessTasks.push({ id: taskId(i), projectId: project, traceId: trace(i), state: i % 2 ? 'closed' : 'failed', callerIdentity: 'demo/demo', createdAt: iso(NOW - minute * 60_000 - 5000), updatedAt: iso(NOW - minute * 60_000 + 60_000), subtasks: [] });
    } else if (i % 3 === 1) world.deliveries.push(delivery(i, minute, i % 4 === 1 ? { state: 'dead' } : {}));
    else world.environments.push(env(i, i, minute, i === 59 ? { state: 'running' } : {}));
    // 同一个事件还投给了另一个项目：traceId 相同，记录属于那个项目。
    if (i % 5 === 0) world.deliveries.push(delivery(i, minute + 30, { projectId: other, id: `foreign-${i}` }));
  }
  world.environments.push(env(100, 100, 1, { state: 'running' }));
  world.deliveries.push(delivery(101, 1));
  return world;
}

const allPages = async (useCases: ReturnType<typeof traceChainUseCases>, query: Partial<TraceListQuery>) => {
  const rows: TraceSummaryDto[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await useCases.listTraces(actor, project, TraceListQuerySchema.parse({ ...query, ...(cursor ? { cursor } : {}) }));
    rows.push(...page.items);
    if (!page.nextCursor) return rows;
    cursor = page.nextCursor;
  }
  throw new Error('翻页没有结束');
};
const expected = (world: World, keep: (traceNo: number) => boolean) => {
  const starts = new Map<string, string>();
  for (const r of [...world.environments, ...world.deliveries].filter((r) => r.projectId === project)) starts.set(r.traceId, (starts.get(r.traceId) ?? r.createdAt) < r.createdAt ? starts.get(r.traceId)! : r.createdAt);
  return [...starts].filter(([t]) => keep(parseInt(t, 16))).sort(([ta, a], [tb, b]) => (a === b ? (ta < tb ? 1 : -1) : a < b ? 1 : -1)).map(([t]) => t);
};
const clock = { now: () => new Date(NOW) };
const allow = { authorize: async () => undefined };

describe('调用链列表', () => {
  test('翻完所有页：每条链恰好出现一次、按开始时间倒序；事件触发的业务任务与投递合成一行，位置取投递的时间', async () => {
    const world = busyWorld(), useCases = traceChainUseCases({ authorizer: allow, chains: sources(world), clock });
    for (const limit of [7, 20, 50]) {
      const rows = await allPages(useCases, { limit });
      expect(rows.map((r) => String(r.traceId))).toEqual(expected(world, () => true));
    }
    const merged = (await allPages(useCases, { limit: 100 })).find((r) => r.traceId === trace(30))!;
    expect(merged).toMatchObject({ sources: ['event', 'business-task'], startedAt: iso(NOW - 330 * 60_000), status: 'failed' });
  });

  test('一个来源很密、另一个很疏且带筛选时，不先放出更旧的记录而漏掉密的那边还没扫到的链', async () => {
    const world: World = { environments: [], deliveries: [], businessTasks: [], events: new Map() };
    for (let i = 1; i <= 30; i++) world.environments.push(env(i, i, i));
    world.environments.push(env(45, 45, 45, { state: 'failed' }));
    for (let i = 1; i <= 25; i++) world.deliveries.push(delivery(200 + i, i * 1440, { state: 'dead' }));
    const useCases = traceChainUseCases({ authorizer: allow, chains: sources(world), clock });
    // 第一轮会话只扫到最近 20 分钟、投递已扫到 20 天前；若不按下界截断，就会先放出几天前的死信，
    // 而 45 分钟前失败的那个会话要到下一轮才扫到——游标已经越过它，它就永远不会出现。
    const failed = await allPages(useCases, { status: 'failed', limit: 7 });
    expect(failed.map((r) => String(r.traceId))).toEqual(expected(world, (n) => n === 45 || n > 200));
    expect(String(failed[0]!.traceId)).toBe(trace(45));
    for (const limit of [7, 25, 45]) expect((await allPages(useCases, { limit })).map((r) => String(r.traceId))).toEqual(expected(world, () => true));
  });

  test('按来源与状态筛选后照样不丢不重；别的项目共用 traceId 的投递不出现', async () => {
    const world = busyWorld(), useCases = traceChainUseCases({ authorizer: allow, chains: sources(world), clock });
    const events = await allPages(useCases, { limit: 6, source: 'event' });
    expect(events.map((r) => String(r.traceId))).toEqual(expected(world, (n) => n === 101 || (n <= 60 && n % 3 !== 2)));
    const failed = await allPages(useCases, { limit: 4, status: 'failed' });
    expect(failed.map((r) => String(r.traceId))).toEqual(expected(world, (n) => n <= 60 && ((n % 3 === 0 && n % 2 === 0) || (n % 3 === 1 && n % 4 === 1))));
    expect(events.every((r) => r.event?.state !== undefined)).toBe(true);
    // trace(5) 在本项目只是一个开发会话；投给别的项目的那条投递不能让它多出「事件」来源。
    expect((await allPages(useCases, { limit: 100 })).find((r) => r.traceId === trace(5))!.sources).toEqual(['dev-session']);
  });

  test('时间范围按有活动算：几小时前开始、仍在进行的开发会话也在「最近 1 小时」里；只看进行中时不论开始多早', async () => {
    const world = busyWorld(), useCases = traceChainUseCases({ authorizer: allow, chains: sources(world), clock });
    const hour = await allPages(useCases, { window: '1h', limit: 1 });
    // trace(60) 的投递在 60 分钟前，但它触发的业务任务 59 分钟前还有活动，所以也算在内。
    expect(hour.map((r) => String(r.traceId))).toEqual([trace(101), trace(100), trace(60), trace(59)]);
    expect((await allPages(useCases, { status: 'running' })).map((r) => String(r.traceId))).toEqual([trace(100), trace(59)]);
    expect((await allPages(useCases, { window: '1h', source: 'event' })).map((r) => String(r.traceId))).toEqual([trace(101), trace(60)]);
  });

  test('窄筛选扫满轮数时先返回已找到的，并给出继续往前找的游标', async () => {
    const world: World = { environments: [], deliveries: [], businessTasks: [], events: new Map() };
    for (let i = 1; i <= 200; i++) world.deliveries.push(delivery(i, 1000 - i, i === 1 ? { state: 'dead' } : {}));
    const calls: string[] = [], useCases = traceChainUseCases({ authorizer: allow, chains: sources(world, calls), clock });
    const first = await useCases.listTraces(actor, project, TraceListQuerySchema.parse({ status: 'failed', limit: 5 }));
    expect(first.items).toEqual([]);
    expect(first.nextCursor).toBeDefined();
    expect(calls.filter((c) => c === 'delivery.keys')).toHaveLength(6);
    expect((await allPages(useCases, { status: 'failed', limit: 5 })).map((r) => String(r.traceId))).toEqual([trace(1)]);
  });

  test('没有查看权限时拒绝，不读任何来源', async () => {
    const calls: string[] = [];
    const useCases = traceChainUseCases({ authorizer: { authorize: async () => { throw forbidden(); } }, chains: sources(busyWorld(), calls), clock });
    await expect(useCases.listTraces(actor, project, TraceListQuerySchema.parse({}))).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(useCases.getTraceChain(actor, project, trace(3))).rejects.toMatchObject({ kind: 'forbidden' });
    expect(calls).toEqual([]);
  });
});

describe('调用链回放与事件', () => {
  const agent = (seq: number, type: string, extra: Record<string, unknown> = {}): TraceStoredEvent => ({ seq, at: iso(NOW), event: { kind: 'agent', event: { agentId: 'a', seq, at: iso(NOW), type, ...extra } } as RunnerEvent });

  function sessionWorld(): World {
    const world: World = { environments: [], deliveries: [], businessTasks: [], events: new Map() };
    world.environments.push(env(1, 7, 30, { state: 'running', branch: 'main' }));
    world.environments.push({ ...env(2, 7, 29, { state: 'released' }), native: { purpose: 'agent', parentTaskId: taskId(1), agentId: 'a', state: 'finished', profile: { name: 'coding-medium' } } });
    // 同一个 traceId 在别的项目里也有记录：回放只带本项目的。
    world.environments.push({ ...env(3, 7, 31), projectId: other, kind: 'business' });
    world.events.set(taskId(2), [agent(1, 'started'), agent(2, 'text', { text: '第一段' }), { seq: 3, at: iso(NOW), event: { kind: 'execExited', execId: 'git-1', exitCode: 0, durationMs: 1 } }, agent(4, 'completed', { result: { summary: '完成' } })]);
    return world;
  }

  test('分层回放只含本项目的任务，执行带事件条数与会话；本项目没有这条链时 404', async () => {
    const useCases = traceChainUseCases({ authorizer: allow, chains: sources(sessionWorld()), clock });
    const chain = await useCases.getTraceChain(actor, project, trace(7));
    expect(chain.tasks.map((t) => t.taskId)).toEqual([taskId(1)]);
    expect(chain.tasks[0]!.executions).toMatchObject([{ taskId: taskId(2), purpose: 'agent', status: 'ended', events: 4, sessionIds: ['ses_1'], protocol: 'opencode' }]);
    await expect(useCases.getTraceChain(actor, project, trace(8))).rejects.toMatchObject({ kind: 'not_found' });
    await expect(useCases.getTraceChain(actor, '01a0bf5d-8f4b-7c09-82e1-9a99060b1192' as ProjectId, trace(7))).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('执行的事件按序号分页，平台命令不列；不属于这条链（或别的项目）的执行 404', async () => {
    const useCases = traceChainUseCases({ authorizer: allow, chains: sources(sessionWorld()), clock });
    const first = await useCases.listTraceEvents(actor, project, trace(7), taskId(2), { limit: 2 });
    expect(first).toEqual({ items: [{ seq: 1, at: iso(NOW), kind: 'agent', type: 'started' }, { seq: 2, at: iso(NOW), kind: 'agent', type: 'text', text: '第一段' }], nextCursor: '2' });
    const second = await useCases.listTraceEvents(actor, project, trace(7), taskId(2), { cursor: '2', limit: 2 });
    expect(second).toEqual({ items: [{ seq: 4, at: iso(NOW), kind: 'agent', type: 'completed', text: '完成' }] });
    await expect(useCases.listTraceEvents(actor, project, trace(7), taskId(3), { limit: 2 })).rejects.toMatchObject({ kind: 'not_found' });
    await expect(useCases.listTraceEvents(actor, project, trace(8), taskId(2), { limit: 2 })).rejects.toMatchObject({ kind: 'not_found' });
  });
});
