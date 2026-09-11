import type { ProjectId } from '@crewstation/contracts';
import { ListDeliveriesQuerySchema, ProjectIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { EventsModuleApi } from '../api/moduleApi';
import { actorFrom } from './actor';

const projectParams = z.object({ projectId: ProjectIdSchema });

/** cs-api 上的查询与重放：事件类型目录、项目的订阅与投递记录、死信重放。 */
export function queryRoutes(api: EventsModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/catalog/event-types', async (c) => c.json({ items: await api.listEventTypes(await actorFrom(c, api)) }));
  r.get('/v1/projects/:projectId/subscriptions', async (c) => {
    const { projectId } = parseParams(c, projectParams);
    return c.json({ items: await api.listSubscriptions(await actorFrom(c, api), projectId as ProjectId) });
  });
  r.get('/v1/projects/:projectId/deliveries', async (c) => {
    const { projectId } = parseParams(c, projectParams);
    const query = parseQuery(c, ListDeliveriesQuerySchema);
    return c.json({ items: await api.listDeliveries(await actorFrom(c, api), projectId as ProjectId, query) });
  });
  r.post('/v1/deliveries/:id/replay', async (c) => {
    const { id } = parseParams(c, z.object({ id: z.string().min(1) }));
    return c.json(await api.replayDelivery(await actorFrom(c, api), id));
  });
  return r;
}
