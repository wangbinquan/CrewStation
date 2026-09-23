import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, mapErrorToResponse } from '@crewstation/http';
import { Hono } from 'hono';
import type { ClusterControlModuleApi } from '../api/moduleApi';

/** 收编空跑报告（设计 §6.5）：只给管理员。 */
export function adoptionRoutes(api: ClusterControlModuleApi, isAdmin: (id: string) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.onError((error, c) => mapErrorToResponse(error, c));
  r.get('/v1/admin/resources/adoption-report', async (c) => {
    const actor = await actorFrom(c, isAdmin);
    return c.json(await api.adoptionReport({ userId: actor.userId as UserId, isAdmin: actor.isAdmin }));
  });
  return r;
}
