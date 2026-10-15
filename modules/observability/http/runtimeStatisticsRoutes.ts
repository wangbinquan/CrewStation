// RFC-034 v2 §5 —— 运行统计的 HTTP 入口：项目（/v1/projects/:projectId/observability/…）与系统
// （/v1/admin/observability/…）两级共用同一组查询；价格与项目费用可见性仅系统。

import type { Actor, ProjectId, UserId } from '@crewstation/contracts';
import {
  ObservationPlatformQuerySchema, ObservationTaskPageQuerySchema, ObservationWindowQuerySchema, ProjectIdSchema, ResourceIdSchema,
  SaveObservationPriceSchema, SetProjectCostVisibilitySchema,
} from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { RuntimeStatisticsApi } from '../api/moduleApi';

const projectParams = z.object({ projectId: ProjectIdSchema });
const taskId = z.string().min(1).max(200);
/** 算力档位 ID，或没有档位的执行所用的 `builtin:<protocol>`。 */
const profileId = z.union([ResourceIdSchema, z.string().regex(/^builtin:[a-z][a-z-]{0,40}$/)]);
const modelQuery = z.object({ model: z.string().trim().min(1).max(300) });
type Handler = (c: Context<AppEnv>) => Promise<Response>;

export function runtimeStatisticsRoutes(api: RuntimeStatisticsApi, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>): Promise<Actor> => {
    const user = await actorFrom(c, (id) => isAdmin(id as UserId));
    return { userId: user.userId as UserId, isAdmin: user.isAdmin };
  };
  const pid = (c: Context<AppEnv>) => parseParams(c, projectParams).projectId as ProjectId;
  // 两级共用同一组查询；路径逐条写全，前台接口面锁（apps/console/src/tests/platformSurface.test.ts）按字面对账。
  const scoped = (scope: (c: Context<AppEnv>) => ProjectId | null): Record<'overview' | 'tasks' | 'task' | 'agents' | 'models', Handler> => ({
    overview: async (c) => c.json(await api.overview(await actor(c), scope(c), parseQuery(c, ObservationWindowQuerySchema))),
    tasks: async (c) => c.json(await api.tasks(await actor(c), scope(c), parseQuery(c, ObservationTaskPageQuerySchema))),
    task: async (c) => c.json(await api.task(await actor(c), scope(c), parseParams(c, z.object({ taskId })).taskId)),
    agents: async (c) => c.json(await api.agents(await actor(c), scope(c), parseQuery(c, ObservationWindowQuerySchema))),
    models: async (c) => c.json(await api.models(await actor(c), scope(c), parseQuery(c, ObservationWindowQuerySchema))),
  });
  const project = scoped(pid), system = scoped(() => null);
  r.get('/v1/projects/:projectId/observability/overview', project.overview);
  r.get('/v1/projects/:projectId/observability/tasks', project.tasks);
  r.get('/v1/projects/:projectId/observability/tasks/:taskId', project.task);
  r.get('/v1/projects/:projectId/observability/agents', project.agents);
  r.get('/v1/projects/:projectId/observability/models', project.models);
  r.get('/v1/admin/observability/overview', system.overview);
  r.get('/v1/admin/observability/tasks', system.tasks);
  r.get('/v1/admin/observability/tasks/:taskId', system.task);
  r.get('/v1/admin/observability/agents', system.agents);
  r.get('/v1/admin/observability/models', system.models);
  r.get('/v1/admin/observability/projects', async (c) => c.json(await api.projects(await actor(c), parseQuery(c, ObservationWindowQuerySchema))));
  r.get('/v1/admin/observability/platform', async (c) => c.json(await api.platform(await actor(c), parseQuery(c, ObservationPlatformQuerySchema))));
  const profile = (c: Context<AppEnv>) => parseParams(c, z.object({ profileId })).profileId;
  r.get('/v1/admin/observability/pricing', async (c) => c.json(await api.pricing(await actor(c))));
  r.get('/v1/admin/observability/pricing/:profileId/history', async (c) => c.json(await api.priceHistory(await actor(c), profile(c), parseQuery(c, modelQuery).model)));
  r.post('/v1/admin/observability/pricing/:profileId', async (c) => c.json(await api.savePrice(await actor(c), profile(c), await parseBody(c, SaveObservationPriceSchema)), 201));
  r.get('/v1/admin/observability/projects/:projectId/cost-visibility', async (c) => c.json(await api.costVisibility(await actor(c), pid(c))));
  r.put('/v1/admin/observability/projects/:projectId/cost-visibility', async (c) => c.json(await api.setCostVisibility(await actor(c), pid(c), await parseBody(c, SetProjectCostVisibilitySchema))));
  return r;
}
