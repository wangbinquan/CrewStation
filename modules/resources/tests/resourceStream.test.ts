import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ResourceStreamEvent } from '@crewstation/contracts';
import { IDENTITY_HEADERS, ResourceStreamEventSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { forbidden, isPlatformError } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { Harness } from './fixtures';
import { createHarness, DEVELOPER, OTHER_PROJECT, OUTSIDER, pod, PROJECT, TESTER, workspace } from './fixtures';

const available = await testDatabaseAvailable();

interface Collector {
  readonly events: ResourceStreamEvent[];
  closed: boolean;
  gate?: Promise<void>;
  waitFor(predicate: (events: readonly ResourceStreamEvent[]) => boolean, ms?: number): Promise<void>;
}

function collector(): Collector {
  const c: Collector = {
    events: [], closed: false,
    waitFor: async (predicate, ms = 3_000) => {
      const deadline = Date.now() + ms;
      while (!predicate(c.events)) {
        if (Date.now() > deadline) throw new Error(`等待推送事件超时：${JSON.stringify(c.events.map((e) => e.type))}`);
        await Bun.sleep(10);
      }
    },
  };
  return c;
}

const ALLOW = { operate: true, admin: false };

describe.skipIf(!available)('推送流（RFC-025 设计 §8）', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ heartbeatMs: 60_000, reauthorizeMs: 40, bufferLimit: 4, perUserLimit: 3 });
    h.module.streamWorker.start();
  });
  afterAll(async () => { await h.module.streamWorker.stop(); await h.database.drop(); });

  const open = (c: Collector, options: { cursor?: number; userId?: string; projectId?: typeof PROJECT; reauthorize?: () => Promise<void> } = {}) => h.module.api.subscribe({
    userId: options.userId ?? DEVELOPER.userId, filter: { projectId: options.projectId ?? PROJECT }, access: ALLOW, ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
    send: async (event) => { ResourceStreamEventSchema.parse(event); if (c.gate) await c.gate; c.events.push(event); },
    reauthorize: options.reauthorize ?? (async () => undefined), close: () => { c.closed = true; },
  });

  test('没有游标先给快照；之后同一资源的阶段变化逐条按序到达，带游标与计数', async () => {
    const c = collector();
    const sub = await open(c);
    await c.waitFor((events) => events.length >= 1);
    expect(c.events[0]?.type).toBe('snapshot');
    const ledger = h.module.api.owner('task-runtime');
    const ws = await ledger.declare(workspace('s1'));
    await h.module.api.observe({ child: pod('task-s1', { uid: 'uid-s1' }) });
    await ledger.requestRelease(ws.id, { code: 'user', message: '释放' });
    await h.module.api.observe({ child: pod('task-s1', { uid: 'uid-s1' }), gone: true });
    await c.waitFor((events) => events.some((e) => e.type === 'upsert' && e.record.phase === 'stopped'));
    const phases = c.events.flatMap((e) => (e.type === 'upsert' && e.record.id === ws.id ? [e.record.phase] : []));
    // 同一批里同一资源只推最后一次：中间态可能合并，但顺序不会倒退，终态一定到达
    const order: readonly string[] = ['provisioning', 'starting', 'stopping', 'stopped'];
    expect(order.filter((p) => phases.includes(p as (typeof phases)[number]))).toEqual(phases.filter((p, i) => phases.indexOf(p) === i));
    expect(phases.at(-1)).toBe('stopped');
    const cursors = c.events.flatMap((e) => ('cursor' in e ? [e.cursor] : []));
    expect(cursors).toEqual([...cursors].sort((a, b) => a - b));
    const last = c.events.at(-1)!;
    expect(last.type === 'upsert' && last.counts).toEqual({});
    sub.close();
    expect(c.closed).toBe(true);
  });

  test('续传：带游标重连补发之后的变更；游标过旧或比日志还新都给快照', async () => {
    const first = collector();
    const sub = await open(first);
    await first.waitFor((events) => events.length >= 1);
    const cursor = (first.events[0] as Extract<ResourceStreamEvent, { type: 'snapshot' }>).cursor;
    sub.close();
    const ws = await h.module.api.owner('task-runtime').declare(workspace('s2'));
    const resumed = collector();
    const again = await open(resumed, { cursor });
    await resumed.waitFor((events) => events.some((e) => e.type === 'upsert' && e.record.id === ws.id));
    expect(resumed.events[0]?.type).toBe('upsert');
    again.close();
    const ahead = collector();
    (await open(ahead, { cursor: 10_000_000 })).close();
    await ahead.waitFor((events) => events.length >= 1);
    expect(ahead.events[0]?.type).toBe('snapshot');
    await h.database.db.execute(sql`DELETE FROM resources.changes WHERE seq <= ${cursor + 1}`);
    const stale = collector();
    (await open(stale, { cursor })).close();
    await stale.waitFor((events) => events.length >= 1);
    expect(stale.events[0]?.type).toBe('snapshot');
  });

  test('只推给这个项目：别的项目的变更不到', async () => {
    const c = collector();
    const sub = await open(c);
    await c.waitFor((events) => events.length >= 1);
    await h.module.api.owner('task-runtime').declare({ ...workspace('s3-other'), projectId: OTHER_PROJECT, spec: { children: [] } });
    const mine = await h.module.api.owner('task-runtime').declare(workspace('s3'));
    await c.waitFor((events) => events.some((e) => e.type === 'upsert' && e.record.id === mine.id));
    expect(c.events.some((e) => e.type === 'upsert' && e.record.owner.ref === 's3-other')).toBe(false);
    sub.close();
  });

  test('慢客户端：缓冲溢出只发 reset 并断开，不拖住写入', async () => {
    const c = collector();
    let release!: () => void;
    await open(c);
    await c.waitFor((events) => events.length >= 1);
    c.gate = new Promise<void>((resolve) => { release = resolve; });
    const ledger = h.module.api.owner('task-runtime');
    for (let i = 0; i < 8; i += 1) { await ledger.declare(workspace(`slow-${i}`, { spec: { children: [] } })); await Bun.sleep(30); }
    release();
    await c.waitFor(() => c.closed);
    expect(c.events.at(-1)).toEqual({ type: 'reset', reason: 'buffer-overflow' });
  });

  test('失权：定时复核不通过，发 reset（forbidden）并断开', async () => {
    const c = collector();
    let allowed = true;
    await open(c, { userId: TESTER.userId, reauthorize: async () => { if (!allowed) throw forbidden('已被移出项目'); } });
    await c.waitFor((events) => events.length >= 1);
    allowed = false;
    await c.waitFor(() => c.closed);
    expect(c.events.at(-1)).toEqual({ type: 'reset', reason: 'forbidden' });
  });

  test('失权：有事件要发时先复核，不通过就只发 reset，事件不会漏给失权的人', async () => {
    const c = collector();
    let allowed = true;
    const hub = await createHarness({ heartbeatMs: 60_000, reauthorizeMs: 60_000, recheckMs: 0 });
    hub.module.streamWorker.start();
    try {
      await hub.module.api.subscribe({
        userId: TESTER.userId, filter: { projectId: PROJECT }, access: ALLOW,
        send: async (event) => { c.events.push(event); }, reauthorize: async () => { if (!allowed) throw forbidden('已被移出项目'); }, close: () => { c.closed = true; },
      });
      await c.waitFor((events) => events.length >= 1);
      allowed = false;
      await hub.module.api.owner('task-runtime').declare(workspace('secret'));
      await c.waitFor(() => c.closed);
      expect(c.events.map((e) => e.type)).toEqual(['snapshot', 'reset']);
      expect(c.events.at(-1)).toEqual({ type: 'reset', reason: 'forbidden' });
    } finally {
      await hub.module.streamWorker.stop();
      await hub.database.drop();
    }
  });

  test('同一个人同时打开的流有上限', async () => {
    const subs = [];
    for (let i = 0; i < 3; i += 1) subs.push(await open(collector(), { userId: OUTSIDER.userId }));
    let kind: string | undefined;
    try { await open(collector(), { userId: OUTSIDER.userId }); } catch (error) { kind = isPlatformError(error) ? error.kind : String(error); }
    expect(kind).toBe('quota_exceeded');
    expect(() => h.module.api.checkStreamCapacity(OUTSIDER.userId)).toThrow('上限');
    subs.forEach((sub) => sub.close());
    expect(() => h.module.api.checkStreamCapacity(OUTSIDER.userId)).not.toThrow();
  });
});

describe.skipIf(!available)('推送流的 SSE 路由', () => {
  let h: Harness;
  let app: ReturnType<typeof createApp>;
  const as = (actor: Actor, extra: Record<string, string> = {}) => ({ [IDENTITY_HEADERS.userId]: actor.userId, [IDENTITY_HEADERS.userName]: 'n', [IDENTITY_HEADERS.userEmail]: 'e@x', ...extra });
  beforeAll(async () => {
    h = await createHarness({ heartbeatMs: 60_000 });
    h.module.streamWorker.start();
    app = createApp({ name: 'resources-stream-test' });
    for (const router of h.module.http) app.route('/', router);
    await h.module.api.owner('task-runtime').declare(workspace('sse1'));
  });
  afterAll(async () => { await h.module.streamWorker.stop(); await h.database.drop(); });

  async function firstFrames(response: Response, until: RegExp): Promise<string> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 3_000;
    while (!until.test(text) && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    await reader.cancel();
    return text;
  }

  test('text/event-stream；第一帧是带 id 的快照；之后的变更以 upsert 帧到达', async () => {
    const response = await app.request(`/v1/projects/${PROJECT}/resources/stream`, { headers: as(DEVELOPER) });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    setTimeout(() => void h.module.api.owner('task-runtime').declare(workspace('sse2')), 100);
    const text = await firstFrames(response, /event: upsert/);
    expect(text).toMatch(/^event: snapshot\ndata: \{.*\}\nid: \d+\n\n/);
    expect(text).toMatch(/event: upsert\ndata: \{.*"ref":"sse2".*\}\nid: \d+/);
  });

  test('Last-Event-ID 续传；游标不合法 400；不是成员 403；管理员流只给管理员', async () => {
    const view = await h.module.api.view(DEVELOPER, PROJECT, {});
    await h.module.api.owner('task-runtime').declare(workspace('sse3'));
    const resumed = await app.request(`/v1/projects/${PROJECT}/resources/stream`, { headers: as(DEVELOPER, { 'last-event-id': String(view.cursor) }) });
    const text = await firstFrames(resumed, /"ref":"sse3"/);
    expect(text.startsWith('event: upsert')).toBe(true);
    expect((await app.request(`/v1/projects/${PROJECT}/resources/stream?cursor=-1`, { headers: as(DEVELOPER) })).status).toBe(400);
    expect((await app.request(`/v1/projects/${PROJECT}/resources/stream`, { headers: as(OUTSIDER) })).status).toBe(403);
    expect((await app.request('/v1/admin/resources/stream', { headers: as(DEVELOPER) })).status).toBe(403);
  });
});
