import type { ServiceId, UserId } from '@crewstation/contracts';
import { ExitMaintenanceRequestSchema, ServiceIdSchema, SetMaintenanceRequestSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, requireUser } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { GatewayModuleApi } from '../api/moduleApi';

const params = z.object({ serviceId: ServiceIdSchema });

/** 正式版本维护（RFC-021 design §5）：读取给项目 `view`，进入、调整、退出只给负责人与管理员。 */
export function maintenanceRoutes(api: GatewayModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => {
    const user = requireUser(c);
    return { userId: user.userId as UserId, isAdmin: await isAdmin(user.userId as UserId) };
  };
  r.get('/v1/services/:serviceId/maintenance', async (c) => { const who = await actor(c); return c.json(await api.getMaintenance(who, parseParams(c, params).serviceId as ServiceId)); });
  r.put('/v1/services/:serviceId/maintenance', async (c) => { const who = await actor(c); return c.json(await api.setMaintenance(who, parseParams(c, params).serviceId as ServiceId, await parseBody(c, SetMaintenanceRequestSchema))); });
  r.post('/v1/services/:serviceId/maintenance/exit', async (c) => { const who = await actor(c); return c.json(await api.exitMaintenance(who, parseParams(c, params).serviceId as ServiceId, await parseBody(c, ExitMaintenanceRequestSchema))); });
  return r;
}
