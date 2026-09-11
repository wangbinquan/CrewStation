import type { UserId } from '@crewstation/contracts';
import { SetAdminRequestSchema, UserIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, requireUser } from '@crewstation/http';
import { forbidden } from '@crewstation/kernel';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { IdentityModuleApi } from '../api/moduleApi';

const userParams = z.object({ userId: UserIdSchema });

/** 管理面（cs-api）：当前用户与用户目录；身份来自网关注入的头。 */
export function userRoutes(api: IdentityModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/me', async (c) => c.json(await api.currentUser(requireUser(c).userId as UserId)));
  r.get('/v1/users', async (c) => {
    await requireAdmin(c, api);
    return c.json({ items: await api.listUsers() });
  });
  r.put('/v1/users/:userId/admin', async (c) => {
    await requireAdmin(c, api);
    const { userId } = parseParams(c, userParams);
    const { isAdmin } = await parseBody(c, SetAdminRequestSchema);
    return c.json(await api.setAdmin(userId as UserId, isAdmin));
  });
  return r;
}

async function requireAdmin(c: Context<AppEnv>, api: Pick<IdentityModuleApi, 'isAdmin'>): Promise<void> {
  if (!(await api.isAdmin(requireUser(c).userId as UserId))) throw forbidden('只有管理员可以管理用户');
}
