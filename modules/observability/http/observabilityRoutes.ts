import type { ProjectId, TaskId, TraceId, UserId } from '@crewstation/contracts';
import { LogQuerySchema, ProjectIdSchema, TaskIdSchema, TraceEventsQuerySchema, TraceIdSchema, TraceListQuerySchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseParams, parseQuery } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ObservabilityModuleApi } from '../api/moduleApi';

const projectParams = z.object({ projectId: ProjectIdSchema });

export function observabilityRoutes(api: ObservabilityModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  const pid = (c: Context<AppEnv>) => parseParams(c, projectParams).projectId as ProjectId;
  // 首版日志直接读 Pod 日志尾部，Kubernetes 的日志接口没有游标，因此只回 items、不回 nextCursor：
  // 往前翻要等 T2.13 的采集与保留落地。查询里的 cursor 字段是给那时预留的，现在不生效。
  r.get('/v1/projects/:projectId/logs', async (c) => c.json({ items: await api.queryLogs(await actor(c), pid(c), parseQuery(c, LogQuerySchema)) }));
  r.get('/v1/projects/:projectId/health', async (c) => c.json({ items: await api.health(await actor(c), pid(c)) }));
  r.get('/v1/projects/:projectId/alerts', async (c) => c.json({ items: await api.listAlerts(await actor(c), pid(c)) }));
  // 调用链（Design §14）：列表、分层回放、执行事件，都只含本项目的记录。
  const traceParams = projectParams.extend({ traceId: TraceIdSchema });
  r.get('/v1/projects/:projectId/traces', async (c) => c.json(await api.listTraces(await actor(c), pid(c), parseQuery(c, TraceListQuerySchema))));
  r.get('/v1/projects/:projectId/traces/:traceId', async (c) => { const p = parseParams(c, traceParams); return c.json(await api.getTraceChain(await actor(c), p.projectId as ProjectId, p.traceId as TraceId)); });
  r.get('/v1/projects/:projectId/traces/:traceId/executions/:taskId/events', async (c) => {
    const p = parseParams(c, traceParams.extend({ taskId: TaskIdSchema }));
    return c.json(await api.listTraceEvents(await actor(c), p.projectId as ProjectId, p.traceId as TraceId, p.taskId as TaskId, parseQuery(c, TraceEventsQuerySchema)));
  });
  return r;
}
