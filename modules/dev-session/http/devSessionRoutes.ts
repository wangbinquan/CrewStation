import type { ProjectId, TaskId, UserId } from '@crewstation/contracts';
import { OpenDevSessionRequestSchema, ProjectIdSchema, PublishDevSessionRequestSchema, SendAgentMessageRequestSchema, StartDevAgentRequestSchema, TaskIdSchema } from '@crewstation/contracts';
import { ComparisonDetailQuerySchema, ComparisonTargetSchema } from '@crewstation/contracts';
import { ApiInvocationRequestSchema } from '@crewstation/contracts';
import { RebuildDevSessionRequestSchema } from '@crewstation/contracts';
import { PreviewActionSchema, PreviewLogsQuerySchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { DevSessionModuleApi } from '../api/moduleApi';

const projectParams = z.object({ projectId: ProjectIdSchema });
const agentParams = z.object({ taskId: TaskIdSchema, agentId: z.string().min(1) });

/** 工作台、CLI 与操作 MCP 共用的开发会话入口（R03）。 */
export function devSessionRoutes(api: DevSessionModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  r.get('/v1/projects/:projectId/dev-session', async (c) => { const s = await api.getSession(await actor(c), parseParams(c, projectParams).projectId as ProjectId); return s ? c.json(s) : c.json({ error: 'not_found', message: '没有开发会话' }, 404); });
  r.post('/v1/projects/:projectId/dev-session', async (c) => c.json(await api.openSession(await actor(c), parseParams(c, projectParams).projectId as ProjectId, await parseBody(c, OpenDevSessionRequestSchema)), 201));
  r.get('/v1/projects/:projectId/dev-session/rebuild', async (c) => { c.header('cache-control', 'no-store'); return c.json(await api.inspectSessionRebuild(await actor(c), parseParams(c, projectParams).projectId)); });
  r.post('/v1/projects/:projectId/dev-session/rebuild', async (c) => c.json(await api.rebuildSession(await actor(c), parseParams(c, projectParams).projectId, await parseBody(c, RebuildDevSessionRequestSchema)), 202));
  r.get('/v1/projects/:projectId/dev-session/workspace-status', async (c) => c.json(await api.workspaceStatus(await actor(c), parseParams(c, projectParams).projectId as ProjectId)));
  // RFC-016 预览进程：工作台、CLI 与操作 MCP 共用这一条入口，授权判定只有用例层一处。
  r.get('/v1/projects/:projectId/dev-session/preview', async (c) => { c.header('cache-control', 'no-store'); return c.json(await api.previewStatus(await actor(c), parseParams(c, projectParams).projectId as ProjectId)); });
  r.get('/v1/projects/:projectId/dev-session/preview/logs', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await api.previewLogs(await actor(c), parseParams(c, projectParams).projectId as ProjectId, parseQuery(c, PreviewLogsQuerySchema)));
  });
  // 一条参数化路由而不是三条字面量：动作由契约枚举校验，不合法的动作得到点名三种取值的 400，
  // 也让客户端构造出的路径与后端声明逐段对得上（接口面锁 `platformSurface.test.ts`）。
  r.post('/v1/projects/:projectId/dev-session/preview/:action', async (c) => {
    const params = parseParams(c, projectParams.extend({ action: PreviewActionSchema }));
    return c.json(await api.controlPreview(await actor(c), params.projectId as ProjectId, params.action));
  });
  r.post('/v1/projects/:projectId/dev-session/api-invocations', async (c) => { c.header('cache-control', 'no-store'); return c.json(await api.invokeApi(await actor(c), parseParams(c, projectParams).projectId as ProjectId, await parseBody(c, ApiInvocationRequestSchema))); });
  r.get('/v1/projects/:projectId/dev-session/version-comparison', async (c) => {
    const query = parseQuery(c, z.object({ target: ComparisonTargetSchema.default('prod') }));
    return c.json(await api.versionComparison(await actor(c), parseParams(c, projectParams).projectId as ProjectId, query.target));
  });
  r.get('/v1/projects/:projectId/dev-session/version-comparisons/:comparisonId', async (c) => {
    const params = parseParams(c, projectParams.extend({ comparisonId: z.string().min(1).max(2048) }));
    return c.json(await api.versionComparisonDetails(await actor(c), params.projectId as ProjectId, params.comparisonId, parseQuery(c, ComparisonDetailQuerySchema)));
  });
  r.post('/v1/projects/:projectId/dev-session/version-comparison/refresh-history', async (c) => {
    const input = await parseBody(c, z.object({ target: ComparisonTargetSchema.default('prod') }));
    return c.json(await api.refreshComparisonHistory(await actor(c), parseParams(c, projectParams).projectId as ProjectId, input.target));
  });
  r.delete('/v1/projects/:projectId/dev-session', async (c) => {
    const { force, expectedTaskId } = parseQuery(c, z.object({ force: z.enum(['true', 'false']).optional(), expectedTaskId: TaskIdSchema.optional() }));
    return c.json(await api.releaseSession(await actor(c), parseParams(c, projectParams).projectId as ProjectId, { force: force === 'true', ...(expectedTaskId ? { expectedTaskId: expectedTaskId as TaskId } : {}) }));
  });
  r.get('/v1/projects/:projectId/branches', async (c) => c.json({ items: await api.listBranches(await actor(c), parseParams(c, projectParams).projectId as ProjectId) }));
  r.post('/v1/projects/:projectId/publish', async (c) => c.json(await api.publish(await actor(c), parseParams(c, projectParams).projectId as ProjectId, await parseBody(c, PublishDevSessionRequestSchema)), 202));
  r.get('/v1/tasks/:taskId/agents', async (c) => c.json({ items: await api.listAgents(await actor(c), parseParams(c, z.object({ taskId: TaskIdSchema })).taskId as TaskId) }));
  r.post('/v1/tasks/:taskId/agents', async (c) => c.json(await api.startAgent(await actor(c), parseParams(c, z.object({ taskId: TaskIdSchema })).taskId as TaskId, await parseBody(c, StartDevAgentRequestSchema)), 201));
  r.post('/v1/tasks/:taskId/agents/:agentId/messages', async (c) => { const p = parseParams(c, agentParams); await api.sendMessage(await actor(c), p.taskId as TaskId, p.agentId, await parseBody(c, SendAgentMessageRequestSchema)); return c.body(null, 204); });
  r.post('/v1/tasks/:taskId/agents/:agentId/cancel', async (c) => { const p = parseParams(c, agentParams); await api.cancelAgent(await actor(c), p.taskId as TaskId, p.agentId); return c.body(null, 204); });
  r.post('/v1/tasks/:taskId/touch', async (c) => { await api.touch(parseParams(c, z.object({ taskId: TaskIdSchema })).taskId as TaskId); return c.body(null, 204); });
  return r;
}
