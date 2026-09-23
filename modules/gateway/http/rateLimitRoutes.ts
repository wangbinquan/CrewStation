import type { ProjectId, UserId } from '@crewstation/contracts';
import { ProjectIdSchema, SetProjectRateLimitsRequestSchema, SetRateLimitSettingsRequestSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, requireUser } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { GatewayModuleApi } from '../api/moduleApi';

const params = z.object({ projectId: ProjectIdSchema });

/** 网关限流策略（RFC-025 设计 §7.3）：平台默认在「平台设置」，项目覆盖在项目的管理设置里；只给管理员。 */
export function rateLimitRoutes(api: GatewayModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => {
    const user = requireUser(c);
    return { userId: user.userId as UserId, isAdmin: await isAdmin(user.userId as UserId) };
  };
  r.get('/v1/admin/settings/rate-limits', async (c) => c.json(await api.getRateLimits(await actor(c))));
  r.put('/v1/admin/settings/rate-limits', async (c) => { const who = await actor(c); return c.json(await api.setRateLimits(who, await parseBody(c, SetRateLimitSettingsRequestSchema))); });
  r.get('/v1/admin/projects/:projectId/rate-limits', async (c) => { const who = await actor(c); return c.json(await api.getProjectRateLimits(who, parseParams(c, params).projectId as ProjectId)); });
  r.put('/v1/admin/projects/:projectId/rate-limits', async (c) => { const who = await actor(c); return c.json(await api.setProjectRateLimits(who, parseParams(c, params).projectId as ProjectId, await parseBody(c, SetProjectRateLimitsRequestSchema))); });
  return r;
}
