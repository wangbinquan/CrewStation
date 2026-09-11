import type { ReleaseId, ServiceId, UserId } from '@crewstation/contracts';
import { PublishRequestSchema, ReleaseIdSchema, ServiceIdSchema, TrafficSwitchRequestSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, requireUser } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ReleaseModuleApi } from '../api/moduleApi';

const serviceParams = z.object({ serviceId: ServiceIdSchema });

/** 发布与切流入口；工作台按钮、CLI 与操作 MCP 都走这里（R03）。 */
export function releaseRoutes(api: ReleaseModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => {
    const user = requireUser(c);
    return { userId: user.userId as UserId, isAdmin: await isAdmin(user.userId as UserId) };
  };
  r.post('/v1/services/:serviceId/releases', async (c) => c.json(await api.publish(await actor(c), parseParams(c, serviceParams).serviceId as ServiceId, await parseBody(c, PublishRequestSchema)), 202));
  r.get('/v1/services/:serviceId/releases', async (c) => c.json({ items: await api.listReleases(await actor(c), parseParams(c, serviceParams).serviceId as ServiceId) }));
  r.get('/v1/releases/:releaseId', async (c) => c.json(await api.getRelease(await actor(c), parseParams(c, z.object({ releaseId: ReleaseIdSchema })).releaseId as ReleaseId)));
  r.get('/v1/services/:serviceId/slots', async (c) => c.json({ items: await api.getSlots(await actor(c), parseParams(c, serviceParams).serviceId as ServiceId) }));
  r.post('/v1/services/:serviceId/traffic-switch', async (c) => c.json(await api.switchTraffic(await actor(c), parseParams(c, serviceParams).serviceId as ServiceId, await parseBody(c, TrafficSwitchRequestSchema))));
  r.get('/v1/services/:serviceId/traffic-switches', async (c) => c.json({ items: await api.listTrafficSwitches(await actor(c), parseParams(c, serviceParams).serviceId as ServiceId) }));
  return r;
}
