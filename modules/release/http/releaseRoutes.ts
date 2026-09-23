import type { ReleaseId, ServiceId, UserId } from '@crewstation/contracts';
import { PostponeOfflineRequestSchema, PublishRequestSchema, RedeployRequestSchema, ReleaseIdSchema, ServiceIdSchema, SetAutoOfflinePolicyRequestSchema, TakeOfflineRequestSchema, TrafficSwitchRequestSchema } from '@crewstation/contracts';
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
  // RFC-021：待命槽的下线、推迟、重新部署与记录；平台设置里的自动下线时长。
  r.post('/v1/services/:serviceId/slots/preview/offline', async (c) => { const who = await actor(c); return c.json({ items: await api.takeOffline(who, parseParams(c, serviceParams).serviceId as ServiceId, await parseBody(c, TakeOfflineRequestSchema)) }); });
  r.post('/v1/services/:serviceId/slots/preview/postpone', async (c) => { const who = await actor(c); return c.json({ items: await api.postponeOffline(who, parseParams(c, serviceParams).serviceId as ServiceId, await parseBody(c, PostponeOfflineRequestSchema)) }); });
  r.post('/v1/releases/:releaseId/redeploy', async (c) => { const who = await actor(c); return c.json(await api.redeploy(who, parseParams(c, z.object({ releaseId: ReleaseIdSchema })).releaseId as ReleaseId, await parseBody(c, RedeployRequestSchema)), 202); });
  r.get('/v1/services/:serviceId/slot-events', async (c) => { const who = await actor(c); return c.json({ items: await api.listSlotEvents(who, parseParams(c, serviceParams).serviceId as ServiceId) }); });
  r.get('/v1/admin/settings/auto-offline', async (c) => c.json(await api.getAutoOfflinePolicy(await actor(c))));
  r.put('/v1/admin/settings/auto-offline', async (c) => { const who = await actor(c); return c.json(await api.setAutoOfflinePolicy(who, await parseBody(c, SetAutoOfflinePolicyRequestSchema))); });
  return r;
}
