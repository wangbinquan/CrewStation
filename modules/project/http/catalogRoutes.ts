import { ComputeProfileDtoSchema, ServicePlanDtoSchema, SlugSchema, TaskProfileDtoSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ProjectModuleApi } from '../api/moduleApi';
import { actorFrom } from './actor';

/** 套餐与算力档位目录：读对所有用户开放，写只有管理员。 */
export function catalogRoutes(api: ProjectModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/catalog/service-plans', async (c) => c.json({ items: await api.listServicePlans() }));
  r.put('/v1/catalog/service-plans', async (c) => c.json(await api.upsertServicePlan(await actorFrom(c, api), await parseBody(c, ServicePlanDtoSchema))));
  r.get('/v1/catalog/task-profiles', async (c) => c.json({ items: await api.listTaskProfiles() }));
  r.put('/v1/catalog/task-profiles', async (c) => c.json(await api.upsertTaskProfile(await actorFrom(c, api), await parseBody(c, TaskProfileDtoSchema))));

  /**
   * 算力档位（RFC-001）。`full=true` 才返回驱动与模型，且仅管理员。
   * 非管理员带 full=true 时按无此参数处理而不是报错：它是查询参数不是权限边界，报错只会让调用方去猜。
   */
  r.get('/v1/catalog/compute-profiles', async (c) => {
    if (c.req.query('full') !== 'true') return c.json({ items: await api.listComputeProfiles() });
    const actor = await actorFrom(c, api);
    if (!actor.isAdmin) return c.json({ items: await api.listComputeProfiles() });
    return c.json({ items: await api.listComputeProfilesFull(actor) });
  });
  r.put('/v1/catalog/compute-profiles', async (c) => c.json(await api.upsertComputeProfile(await actorFrom(c, api), await parseBody(c, ComputeProfileDtoSchema))));
  r.delete('/v1/catalog/compute-profiles/:name', async (c) => {
    await api.deleteComputeProfile(await actorFrom(c, api), parseParams(c, z.object({ name: SlugSchema })).name);
    return c.body(null, 204);
  });
  return r;
}
