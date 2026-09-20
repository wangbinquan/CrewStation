import { computeId } from './computeFixture';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { NativeTerminalRecord } from '@crewstation/contracts';
import { AgentActivityPageSchema, IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { forbidden, newId } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleNativeTerminals } from '../adapters/persistence/drizzleNativeTerminals';
import { createDevSessionModule, devSessionMigrations } from '../wiring';
import { checkedAt, workspaceActor, workspaceFixture, workspaceTask } from './workspaceFixture';

const available = await testDatabaseAvailable();
let db: TestDatabase;
beforeAll(async () => { if (available) db = await createTestDatabase([devSessionMigrations]); });
afterAll(async () => { await db?.drop(); });

describe.skipIf(!available)('动态资源实际装配与 HTTP', () => {
  test('读写路径、默认分页与 no-store；动态存储失败仍能列出 CLI，权限错误继续拒绝', async () => {
    const f = workspaceFixture(); const taskId = workspaceTask;
    const record: NativeTerminalRecord = { agentId: newId('agt'), terminalId: newId('pty'), runnerId: crypto.randomUUID(), lifecycle: 'running', revision: 1, compute: computeId('balanced'), permission: 'edit', startedAt: checkedAt, cols: 80, rows: 24 };
    f.state.result = { runnerId: record.runnerId, terminals: [record] };
    await drizzleNativeTerminals(db.db).reserve({ taskId, record, createdBy: workspaceActor.userId, clientRequestId: crypto.randomUUID(), fingerprint: 'http', profile: { profileId: computeId('balanced'), revision: 1 }, input: { clientRequestId: crypto.randomUUID(), permission: 'edit', cols: 80, rows: 24 } });
    f.deps.runner.listEvents = async (_task, query) => query?.sinceSeq ? [] : [{ seq: 1, at: checkedAt, event: { kind: 'nativeActivity', activity: { agentId: record.agentId, terminalId: record.terminalId, runnerId: record.runnerId, seq: 1, turnOrdinal: 0, eventId: 'source-ready', signal: { kind: 'source-ready', nativeSessionId: null, turnId: null, occurredAt: checkedAt, source: 'claude-code/2.1.268', sourceEventId: 'ready' } } } }];
    const module = createDevSessionModule({ ...f.deps, db: db.db, isAdmin: async () => false });
    const app = createApp({ name: 'activity-test' }); for (const route of module.http) app.route('/', route);
    const url = `/v1/tasks/${taskId}/agent-activity`;
    const headers = { [IDENTITY_HEADERS.userId]: workspaceActor.userId, 'content-type': 'application/json' };
    const response = await app.request(url, { headers });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(AgentActivityPageSchema.parse(await response.json())).toMatchObject({ sync: 'ready', connection: 'connected', throughSeq: 1, states: [{ source: 'ready' }] });
    const roster = await module.api.listNativeTerminals(workspaceActor, taskId);
    expect(roster).toMatchObject({ activitySync: 'ready', items: [{ lifecycle: 'running', activity: { source: 'ready' } }] });
    let unlock!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; }), hold = new Promise<void>((resolve) => { unlock = resolve; });
    const blocked = db.db.transaction(async (tx) => { await tx.execute(sql`lock table dev_session.native_activity_sources in access exclusive mode`); locked(); await hold; });
    await ready;
    let timer: ReturnType<typeof setTimeout>;
    try {
      const response = await Promise.race([module.api.listNativeTerminals(workspaceActor, taskId), new Promise<string>((resolve) => { timer = setTimeout(() => resolve('still waiting'), 3200); })]);
      // 活动存储等待不能拖住健康终端的名册；降级后保留原进程身份。
      expect(response).toMatchObject({ activitySync: 'unavailable', items: [{ agentId: record.agentId, lifecycle: 'running' }] });
    } finally { clearTimeout(timer!); unlock(); await blocked; }
    expect((await module.api.listNativeTerminals(workspaceActor, taskId)).activitySync).toBe('ready');
    expect((await app.request(`${url}?limit=101`, { headers })).status).toBe(400);
    expect((await app.request(`${url}?cursor=1.5`, { headers })).status).toBe(400);
    expect((await app.request(`${url}?unread=true&before=2`, { headers })).status).toBe(200);
    expect((await app.request(`${url}?unread=false`, { headers })).status).toBe(200);
    expect((await app.request(`${url}?unread=maybe`, { headers })).status).toBe(400);
    expect((await app.request(`${url}?before=2&cursor=0`, { headers })).status).toBe(400);
    const read = await app.request(`${url}/read`, { method: 'POST', headers, body: JSON.stringify({ agentId: record.agentId, turnId: 'missing', throughSeq: 1 }) });
    expect(read.status).toBe(400); expect(read.headers.get('cache-control')).toBe('no-store');
    expect((await app.request(url)).status).toBe(401);
    await db.db.execute(sql`alter table dev_session.native_activity_items rename to native_activity_items_unavailable`);
    try {
      const degraded = await module.api.listNativeTerminals(workspaceActor, taskId);
      expect(degraded).toMatchObject({ activitySync: 'unavailable', items: [{ lifecycle: 'running' }] });
      expect(degraded.items[0]?.activity).toBeUndefined();
      f.deps.authorizer.authorize = async () => { throw forbidden(); };
      expect((await app.request(url, { headers })).status).toBe(403);
      await expect(module.api.listNativeTerminals(workspaceActor, taskId)).rejects.toMatchObject({ kind: 'forbidden' });
    } finally { await db.db.execute(sql`alter table dev_session.native_activity_items_unavailable rename to native_activity_items`); }
  });
});
