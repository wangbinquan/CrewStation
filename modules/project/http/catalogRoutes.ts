import { ServicePlanDtoSchema, TaskProfileDtoSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody } from '@crewstation/http';
import { Hono } from 'hono';
import type { ProjectModuleApi } from '../api/moduleApi';
import { actorFrom } from './actor';

/** 服务套餐与任务套餐目录：读对所有用户开放，写只有管理员。算力档位归 agent-runtime（RFC-006、ADR-0005）。 */
export function catalogRoutes(api: ProjectModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/catalog/service-plans', async (c) => c.json({ items: await api.listServicePlans() }));
  r.put('/v1/catalog/service-plans', async (c) => c.json(await api.upsertServicePlan(await actorFrom(c, api), await parseBody(c, ServicePlanDtoSchema))));
  r.get('/v1/catalog/task-profiles', async (c) => c.json({ items: await api.listTaskProfiles() }));
  r.put('/v1/catalog/task-profiles', async (c) => c.json(await api.upsertTaskProfile(await actorFrom(c, api), await parseBody(c, TaskProfileDtoSchema))));

  r.get('/v1/catalog/project-creation', async (c) => c.json(await api.creationCatalog(await actorFrom(c, api))));
  return r;
}
