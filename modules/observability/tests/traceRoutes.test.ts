import { describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId, TaskId, TraceId, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, TraceChainDtoSchema, TraceEventPageSchema, TraceSummaryPageSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient } from '@crewstation/k8s';
import { forbidden } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { TraceEnvironmentPart } from '../domain/traceParts';
import { createObservabilityModule } from '../wiring';

const project = '01a0bf5d-8f4b-7d01-82e1-9a99060b1192' as ProjectId;
const member = '01a0bf5d-8f4b-7d02-867c-efd7527b386b' as UserId, stranger = '01a0bf5d-8f4b-7d03-867c-efd7527b386b' as UserId;
const TRACE = 'fedcba9876543210fedcba9876543210' as TraceId;
const session: TraceEnvironmentPart = { id: '01a0bf5d-8f4b-7d04-8a3f-7cbb4a1fd751' as TaskId, traceId: TRACE, kind: 'dev-session', state: 'running', createdAt: '2026-09-23T10:00:00.000Z', updatedAt: '2026-09-23T10:05:00.000Z', lastActivityAt: '2026-09-23T10:04:00.000Z', branch: 'main' };
const cli: TraceEnvironmentPart = { ...session, id: '01a0bf5d-8f4b-7d05-8a3f-7cbb4a1fd751' as TaskId, createdAt: '2026-09-23T10:01:00.000Z',
  native: { purpose: 'cli', parentTaskId: session.id, agentId: 'agent-1', state: 'running', profile: { name: 'coding-medium' } } };

/** 真实的路由与参数校验；数据来源是内存里的一条开发会话链，授权端口拒绝项目外的人。 */
function app() {
  const obs = createObservabilityModule({
    db: {} as Database, k8s: createFakeK8sClient(), isAdmin: async () => false,
    authorizer: { authorize: async (actor) => { if (actor.userId !== member) throw forbidden(); } },
    services: { resolveServiceOfProject: async () => ({ serviceId: '01a0bf5d-8f4b-7d06-866c-f1feda3d63bb' as ServiceId, slug: 'demo', name: 'demo', namespace: 'cs-demo' }) },
    slots: { slotRoles: async () => undefined },
    traces: {
      environments: {
        traceKeys: async (_p, page) => (page.before ? [] : [{ traceId: TRACE, firstAt: session.createdAt, lastAt: session.updatedAt, active: true }]),
        activeTraceIds: async () => [TRACE],
        list: async (projectId, ids) => (projectId === project && ids.includes(TRACE) ? [session, cli] : []),
      },
      deliveries: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] },
      businessTasks: { list: async () => [] },
      sessions: {
        summarize: async (ids) => ids.map((taskId) => ({ taskId, events: 2, sessionIds: ['native-1'], protocol: 'claude-code' })),
        events: async (_taskId, page) => [{ seq: 5, at: '2026-09-23T10:02:00.000Z', event: { kind: 'terminalClosed' as const, terminalId: 't', exitCode: 0 } }].filter((e) => e.seq > page.afterSeq),
      },
    },
  });
  const server = createApp({ name: 'trace-routes' });
  for (const routes of obs.http) server.route('/', routes);
  return server;
}

const as = (userId: UserId) => ({ headers: { [IDENTITY_HEADERS.userId]: userId } });
const base = `/v1/projects/${project}/traces`;

describe('调用链路由', () => {
  test('列表、回放与执行事件的成功路径，响应符合契约', async () => {
    const server = app();
    const list = await server.request(`${base}?window=24h&status=running&limit=10`, as(member));
    expect(list.status).toBe(200);
    expect(TraceSummaryPageSchema.parse(await list.json()).items).toMatchObject([{ traceId: TRACE, status: 'running', sources: ['dev-session'], devSession: { branch: 'main', clis: 1, agents: 0 } }]);
    const chain = await server.request(`${base}/${TRACE}`, as(member));
    expect(chain.status).toBe(200);
    expect(TraceChainDtoSchema.parse(await chain.json()).tasks[0]!.executions).toMatchObject([{ taskId: cli.id, purpose: 'cli', protocol: 'claude-code', sessionIds: ['native-1'], events: 2 }]);
    const events = await server.request(`${base}/${TRACE}/executions/${cli.id}/events?limit=5`, as(member));
    expect(events.status).toBe(200);
    expect(TraceEventPageSchema.parse(await events.json()).items).toEqual([{ seq: 5, at: '2026-09-23T10:02:00.000Z', kind: 'terminal-closed', exitCode: 0 }]);
  });

  test('没登录 401，项目外的人 403', async () => {
    const server = app();
    for (const path of [base, `${base}/${TRACE}`, `${base}/${TRACE}/executions/${cli.id}/events`]) {
      expect((await server.request(path)).status).toBe(401);
      expect((await server.request(path, as(stranger))).status).toBe(403);
    }
  });

  test('参数不合法 400：筛选取值、游标、每页条数、traceId 与执行 ID 的格式', async () => {
    const server = app();
    for (const query of ['source=cli', 'status=succeeded', 'window=30d', 'limit=0', 'limit=101', 'cursor=next']) expect((await server.request(`${base}?${query}`, as(member))).status).toBe(400);
    expect((await server.request(`${base}/not-a-trace`, as(member))).status).toBe(400);
    expect((await server.request(`${base}/${TRACE}/executions/not-a-task/events`, as(member))).status).toBe(400);
    expect((await server.request(`${base}/${TRACE}/executions/${cli.id}/events?cursor=-1`, as(member))).status).toBe(400);
  });

  test('本项目里没有的链、链上没有的执行 404', async () => {
    const server = app();
    expect((await server.request(`${base}/${'0'.repeat(32)}`, as(member))).status).toBe(404);
    expect((await server.request(`${base}/${TRACE}/executions/01a0bf5d-8f4b-7d09-8a3f-7cbb4a1fd751/events`, as(member))).status).toBe(404);
  });
});
