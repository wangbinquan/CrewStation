import type { ProjectId, TaskId, UserId } from '@crewstation/contracts';
import { OpenDevSessionRequestSchema, ProjectIdSchema, PublishRequestSchema, SendAgentMessageRequestSchema, StartDevAgentRequestSchema, TaskIdSchema } from '@crewstation/contracts';
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
  r.delete('/v1/projects/:projectId/dev-session', async (c) => {
    const { force } = parseQuery(c, z.object({ force: z.enum(['true', 'false']).optional() }));
    return c.json(await api.releaseSession(await actor(c), parseParams(c, projectParams).projectId as ProjectId, { force: force === 'true' }));
  });
  r.get('/v1/projects/:projectId/branches', async (c) => c.json({ items: await api.listBranches(await actor(c), parseParams(c, projectParams).projectId as ProjectId) }));
  r.post('/v1/projects/:projectId/publish', async (c) => c.json(await api.publish(await actor(c), parseParams(c, projectParams).projectId as ProjectId, await parseBody(c, PublishRequestSchema)), 202));
  r.get('/v1/tasks/:taskId/agents', async (c) => c.json({ items: await api.listAgents(await actor(c), parseParams(c, z.object({ taskId: TaskIdSchema })).taskId as TaskId) }));
  r.post('/v1/tasks/:taskId/agents', async (c) => c.json(await api.startAgent(await actor(c), parseParams(c, z.object({ taskId: TaskIdSchema })).taskId as TaskId, await parseBody(c, StartDevAgentRequestSchema)), 201));
  r.post('/v1/tasks/:taskId/agents/:agentId/messages', async (c) => { const p = parseParams(c, agentParams); await api.sendMessage(await actor(c), p.taskId as TaskId, p.agentId, await parseBody(c, SendAgentMessageRequestSchema)); return c.body(null, 204); });
  r.post('/v1/tasks/:taskId/agents/:agentId/cancel', async (c) => { const p = parseParams(c, agentParams); await api.cancelAgent(await actor(c), p.taskId as TaskId, p.agentId); return c.body(null, 204); });
  r.post('/v1/tasks/:taskId/touch', async (c) => { await api.touch(parseParams(c, z.object({ taskId: TaskIdSchema })).taskId as TaskId); return c.body(null, 204); });
  return r;
}
