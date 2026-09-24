import { CreateAppAccessRequestSchema, DecideAppAccessRequestSchema, ProjectIdSchema, RequestPageQuerySchema, ResourceIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ProjectModuleApi } from '../api/moduleApi';
import { actorFrom } from './actor';

/**
 * 应用使用申请（2026-09-24 裁定）：`/v1/apps/:projectId/…` 是申请人一侧，任何登录用户可用；
 * `/v1/app-access-requests…` 是负责人与管理员的清单与审批。
 */
export function appAccessRoutes(api: ProjectModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const app = z.object({ projectId: ProjectIdSchema });
  r.get('/v1/apps/:projectId/access', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await api.getAppAccessStatus(await actorFrom(c, api), parseParams(c, app).projectId));
  });
  r.post('/v1/apps/:projectId/access-requests', async (c) =>
    c.json(await api.requestAppAccess(await actorFrom(c, api), parseParams(c, app).projectId, await parseBody(c, CreateAppAccessRequestSchema)), 201));
  r.get('/v1/app-access-requests', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await api.listAppAccessRequests(await actorFrom(c, api), parseQuery(c, RequestPageQuerySchema)));
  });
  r.post('/v1/app-access-requests/:requestId/decision', async (c) => {
    const { requestId } = parseParams(c, z.object({ requestId: ResourceIdSchema }));
    return c.json(await api.decideAppAccessRequest(await actorFrom(c, api), requestId, await parseBody(c, DecideAppAccessRequestSchema)));
  });
  return r;
}
