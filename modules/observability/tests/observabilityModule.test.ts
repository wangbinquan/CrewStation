import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ServiceId, TaskId, TraceId, UserId } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient } from '@crewstation/k8s';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { healthOf } from '../domain/health';
import { slotOfAlert } from '../domain/alertRules';
import type { ObservabilityModule } from '../wiring';
import { createObservabilityModule, observabilityMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let obs: ObservabilityModule;
const projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192' as ProjectId;
const actor: Actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, isAdmin: false };
let ready = 0;
const logSelectors: string[] = [];

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([observabilityMigrations]);
  obs = createObservabilityModule({
    db: tdb.db, k8s: createFakeK8sClient(), isAdmin: async () => false,
    authorizer: { authorize: async () => undefined },
    services: { resolveServiceOfProject: async () => ({ serviceId: '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId, slug: 'demo', name: 'demo', namespace: 'cs-demo' }) },
    slots: { slotRoles: async () => ({ prod: 'blue', preview: 'green' }) },
    cluster: {
      observeDeployment: async (_ns, name) => (name === 'demo-blue' ? { replicas: 1, readyReplicas: ready, restarts: 0, lastTransitionAt: '2026-09-11T00:00:00Z' } : undefined),
      tailLogs: async (_namespace, selector) => {
        logSelectors.push(selector);
        return [{ ts: '2026-09-11T00:00:00.000Z', source: 'slot', stream: 'stdout', message: 'hello' }];
      },
    },
    traces: {
      tasksByTrace: async () => [{ taskId: '01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd751' as TaskId, kind: 'business', createdAt: '2026-09-11T00:00:00Z' }],
      subtasksOfTask: async () => [{ id: 'sub_0123456789abcdef0123456789abcdef', taskId: '01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd751', name: 'analysis', kind: 'agent', state: 'succeeded', attempt: 1, sessionId: 'sess-1' } as never],
      sessionEvents: async () => [{ seq: 1, at: '2026-09-11T00:00:01Z', event: { kind: 'agent', event: { agentId: 'a', sessionId: 'sess-1', type: 'text', text: 'hi' } } }],
    },
  });
});
afterAll(async () => { await tdb?.drop(); });

describe('健康态判定', () => {
  test('告警仅用已知规则 key 定位槽，未知关联不猜正式版本', () => {
    expect(slotOfAlert('health-failing', 'health-failing:preview')).toBe('preview');
    expect(slotOfAlert('crash-loop', 'crash-loop:prod')).toBe('prod');
    expect(slotOfAlert('crash-loop', 'health-failing:prod')).toBeUndefined();
    expect(slotOfAlert('health-failing', 'health-failing:unknown')).toBeUndefined();
  });
  test('崩溃循环、降级、不健康、健康', () => {
    expect(healthOf({ replicas: 2, readyReplicas: 2, restarts: 5, lastRestartAgeSeconds: 30 })).toBe('crash-looping');
    expect(healthOf({ replicas: 2, readyReplicas: 1, restarts: 0 })).toBe('degraded');
    expect(healthOf({ replicas: 2, readyReplicas: 0, restarts: 0 })).toBe('unhealthy');
    expect(healthOf({ replicas: 2, readyReplicas: 2, restarts: 5, lastRestartAgeSeconds: 7200 })).toBe('healthy');
  });
});

describe.skipIf(!available)('observability module', () => {
  test('日志全部部署槽不退回正式槽或混入任务，显式槽仍按当前角色选择', async () => {
    const start = logSelectors.length;
    const all = await obs.api.queryLogs(actor, projectId, { source: 'slot', limit: 100 });
    await obs.api.queryLogs(actor, projectId, { source: 'slot', slot: 'prod', limit: 100 });
    await obs.api.queryLogs(actor, projectId, { source: 'slot', slot: 'preview', limit: 100 });
    // UI 的“全部槽”已省略 slot，旧用例却以 query.slot ?? 'prod' 悄悄缩窄了实际日志。
    expect(logSelectors.slice(start)).toEqual([
      'crewstation.io/service=demo,crewstation.io/workload=service',
      'crewstation.io/service=demo,crewstation.io/slot=blue',
      'crewstation.io/service=demo,crewstation.io/slot=green',
    ]);
    expect(all[0]?.slot).toBeUndefined();
  });

  test('健康与日志、告警触发与恢复、traceId 回放', async () => {
    ready = 0;
    expect((await obs.api.health(actor, projectId)).map((h) => [h.slot, h.state])).toEqual([['prod', 'unhealthy'], ['preview', 'unknown']]);
    expect((await obs.api.queryLogs(actor, projectId, { source: 'slot', slot: 'prod', limit: 100 }))[0]?.message).toBe('hello');
    expect(await obs.api.sweepProject(projectId)).toBe(1);
    expect(await obs.api.sweepProject(projectId)).toBe(0);
    expect((await obs.api.listAlerts(actor, projectId))[0]).toMatchObject({ type: 'health-failing', state: 'firing', slot: 'prod' });
    ready = 1;
    expect(await obs.api.sweepProject(projectId)).toBe(1);
    expect((await obs.api.listAlerts(actor, projectId))[0]?.state).toBe('resolved');
    const replay = await obs.api.replayTrace(actor, projectId, '0123456789abcdef0123456789abcdef' as TraceId);
    expect(replay.sessionIds).toEqual(['sess-1']);
    expect(replay.events[0]?.type).toBe('agent.text');
  });

  // 基线 v0.3.13（D61）删除了项目级告警订阅：迁移删掉订阅表，三条订阅接口不再挂载；告警列表接口不受影响。
  test('告警订阅已删除：订阅表不存在，订阅接口 404，告警列表接口仍在', async () => {
    expect([...(await tdb.db.execute(`SELECT to_regclass('observability.alert_subscriptions') AS table_name`))]).toEqual([{ table_name: null }]);
    const app = createApp({ name: 'observability-test' }); for (const r of obs.http) app.route('/', r);
    const base = `/v1/projects/${projectId}`;
    expect((await app.request(`${base}/alert-subscriptions`)).status).toBe(404);
    expect((await app.request(`${base}/alert-subscriptions`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: actor.userId, channel: 'workbench' }) })).status).toBe(404);
    expect((await app.request(`${base}/alert-subscriptions/${actor.userId}`, { method: 'DELETE' })).status).toBe(404);
    // 同一前缀下仍挂载的告警列表：没带身份是 401 而不是 404，说明上面的 404 不是路径写错。
    expect((await app.request(`${base}/alerts`)).status).toBe(401);
  });
});
