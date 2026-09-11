import type { ProjectId, UserId } from '@crewstation/contracts';
import { ProjectIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseParams } from '@crewstation/http';
import { forbidden } from '@crewstation/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ProvisioningModuleApi } from '../api/moduleApi';

/** 管理员重新触发开通链（失败项目修复后使用）。 */
export function provisioningRoutes(api: ProvisioningModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.post('/v1/projects/:projectId/provision', async (c) => {
    const actor = await actorFrom(c, (id) => isAdmin(id as UserId));
    if (!actor.isAdmin) throw forbidden('只有管理员可以重新开通项目');
    await api.retry(parseParams(c, z.object({ projectId: ProjectIdSchema })).projectId as ProjectId);
    return c.json({ accepted: true }, 202);
  });
  return r;
}
