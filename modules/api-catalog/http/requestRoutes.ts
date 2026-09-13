import type { ProjectId, ServiceId } from '@crewstation/contracts';
import { CreateApiRequestSchema, DecideApiRequestSchema, ProjectIdSchema, RequestPageQuerySchema, ServiceIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiCatalogModuleApi } from '../api/moduleApi';
import { actorFrom } from './actor';

const serviceParams = z.object({ serviceId: ServiceIdSchema });

/** 定向开放的申请、审批与撤销。 */
export function requestRoutes(api: ApiCatalogModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/api-requests/page', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await api.listRequestPage(await actorFrom(c, api), parseQuery(c, RequestPageQuerySchema)));
  });
  r.post('/v1/services/:serviceId/api-requests', async (c) => {
    const { serviceId } = parseParams(c, serviceParams);
    return c.json(await api.requestAccess(await actorFrom(c, api), serviceId as ServiceId, await parseBody(c, CreateApiRequestSchema)), 201);
  });
  r.get('/v1/api-requests', async (c) => {
    const { projectId } = parseQuery(c, z.object({ projectId: ProjectIdSchema.optional() }));
    return c.json({ items: await api.listRequests(await actorFrom(c, api), projectId as ProjectId | undefined) });
  });
  r.post('/v1/api-requests/:id/decision', async (c) => {
    const { id } = parseParams(c, z.object({ id: z.string().min(1) }));
    return c.json(await api.decideRequest(await actorFrom(c, api), id, await parseBody(c, DecideApiRequestSchema)));
  });
  r.delete('/v1/services/:serviceId/grants/:key', async (c) => {
    const { serviceId, key } = parseParams(c, serviceParams.extend({ key: z.string().min(1) }));
    await api.revokeGrant(await actorFrom(c, api), serviceId as ServiceId, key);
    return c.body(null, 204);
  });
  return r;
}
