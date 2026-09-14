import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ServiceId, TaskId, TraceId, UserId } from '@crewstation/contracts';
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
const projectId = 'prj_0123456789abcdef0123456789abcdef' as ProjectId;
const actor: Actor = { userId: 'usr_0123456789abcdef0123456789abcdef' as UserId, isAdmin: false };
let ready = 0;
const notices: string[] = [];
const logSelectors: string[] = [];

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([observabilityMigrations]);
  obs = createObservabilityModule({
    db: tdb.db, k8s: createFakeK8sClient(), isAdmin: async () => false,
    authorizer: { authorize: async () => undefined },
    services: { resolveServiceOfProject: async () => ({ serviceId: 'svc_0123456789abcdef0123456789abcdef' as ServiceId, slug: 'demo', name: 'demo', namespace: 'cs-demo' }) },
    slots: { slotRoles: async () => ({ prod: 'blue', preview: 'green' }) },
    cluster: {
      observeDeployment: async (_ns, name) => (name === 'demo-blue' ? { replicas: 1, readyReplicas: ready, restarts: 0, lastTransitionAt: '2026-09-11T00:00:00Z' } : undefined),
      tailLogs: async (_namespace, selector) => {
        logSelectors.push(selector);
        return [{ ts: '2026-09-11T00:00:00.000Z', source: 'slot', stream: 'stdout', message: 'hello' }];
      },
    },
    traces: {
      tasksByTrace: async () => [{ taskId: 'tsk_0123456789abcdef0123456789abcdef' as TaskId, kind: 'business', createdAt: '2026-09-11T00:00:00Z' }],
      subtasksOfTask: async () => [{ id: 'sub_0123456789abcdef0123456789abcdef', taskId: 'tsk_0123456789abcdef0123456789abcdef', name: 'analysis', kind: 'agent', state: 'succeeded', attempt: 1, sessionId: 'sess-1' } as never],
      sessionEvents: async () => [{ seq: 1, at: '2026-09-11T00:00:01Z', event: { kind: 'agent', event: { agentId: 'a', sessionId: 'sess-1', type: 'text', text: 'hi' } } }],
    },
    notifier: { notify: async (_p, m) => { notices.push(m); } },
  });
});
afterAll(async () => { await tdb?.drop(); });

describe('健康态判定', () => {
  test('告警仅用已知规则 key 定位槽，未知关联不猜正式版本', () => {
    expect(slotOfAlert('health-failing', 'health-failing:preview')).toBe('preview');
    expect(slotOfAlert('crash-loop', 'crash-loop:prod')).toBe('prod');
    expect(slotOfAlert('task-failed', 'task-failed:prod')).toBeUndefined();
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
    expect(notices).toHaveLength(1);
    ready = 1;
    expect(await obs.api.sweepProject(projectId)).toBe(1);
    expect((await obs.api.listAlerts(actor, projectId))[0]?.state).toBe('resolved');
    await obs.api.subscribe(actor, projectId, { userId: actor.userId, channel: 'workbench' });
    expect(await obs.api.listSubscriptions(actor, projectId)).toHaveLength(1);
    const replay = await obs.api.replayTrace(actor, projectId, '0123456789abcdef0123456789abcdef' as TraceId);
    expect(replay.sessionIds).toEqual(['sess-1']);
    expect(replay.events[0]?.type).toBe('agent.text');
  });
});
