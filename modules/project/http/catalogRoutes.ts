import { validation } from '@crewstation/kernel';
import { CreateServicePlanSchema, CreateTaskProfileSchema, ResourceIdSchema, ServicePlanInputSchema, TaskProfileInputSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody } from '@crewstation/http';
import { Hono } from 'hono';
import type { ProjectModuleApi } from '../api/moduleApi';
import { actorFrom } from './actor';

/** 服务套餐与任务套餐目录：读对所有用户开放，写只有管理员。算力档位归 agent-runtime（RFC-006、ADR-0005）。 */
export function catalogRoutes(api: ProjectModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.put('/v1/catalog/service-plans', () => { throw validation('资源身份已升级：新增请使用 POST；修改请使用 PUT /v1/catalog/service-plans/{UUIDv7}'); });
  r.put('/v1/catalog/task-profiles', () => { throw validation('资源身份已升级：新增请使用 POST；修改请使用 PUT /v1/catalog/task-profiles/{UUIDv7}'); });
  r.get('/v1/catalog/service-plans', async (c) => c.json({ items: await api.listServicePlans() }));
  r.post('/v1/catalog/service-plans', async (c) => c.json(await api.createServicePlan(await actorFrom(c, api), await parseBody(c, CreateServicePlanSchema))));
  r.get('/v1/catalog/task-profiles', async (c) => c.json({ items: await api.listTaskProfiles() }));
  r.post('/v1/catalog/task-profiles', async (c) => c.json(await api.createTaskProfile(await actorFrom(c, api), await parseBody(c, CreateTaskProfileSchema))));

  r.put('/v1/catalog/service-plans/:id', async (c) => c.json(await api.updateServicePlan(await actorFrom(c, api), ResourceIdSchema.parse(c.req.param('id')), await parseBody(c, ServicePlanInputSchema))));
  r.put('/v1/catalog/task-profiles/:id', async (c) => c.json(await api.updateTaskProfile(await actorFrom(c, api), ResourceIdSchema.parse(c.req.param('id')), await parseBody(c, TaskProfileInputSchema))));
  r.get('/v1/catalog/project-creation', async (c) => c.json(await api.creationCatalog(await actorFrom(c, api))));
  return r;
}
