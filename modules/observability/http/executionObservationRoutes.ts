import { ExecutionObservationQuerySchema, ProjectIdSchema, SetExecutionCostVisibilitySchema, TaskIdSchema, type UserId } from '@crewstation/contracts';
import { actorFrom, parseBody, parseParams, parseQuery, requireService, type AppEnv } from '@crewstation/http';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ObservabilityModuleApi } from '../api/moduleApi';

export function executionObservationRoutes(api: ObservabilityModuleApi, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/v3/business-tasks/:taskId/observations', async (c) => {
    const caller = requireService(c), { taskId } = parseParams(c, z.object({ taskId: TaskIdSchema }));
    return c.json(await api.executionObservations({ identity: caller.identity, ...(caller.token ? { token: caller.token } : {}) }, taskId, parseQuery(c, ExecutionObservationQuerySchema)));
  });
  const actor = async (c: Context<AppEnv>) => {
    const value = await actorFrom(c, (id) => isAdmin(id as UserId));
    return { userId: value.userId as UserId, isAdmin: value.isAdmin };
  };
  const project = (c: Context<AppEnv>) => parseParams(c, z.object({ projectId: ProjectIdSchema })).projectId;
  routes.get('/v1/admin/observability/projects/:projectId/cost-visibility', async (c) => c.json(await api.executionCostVisibility(await actor(c), project(c))));
  routes.put('/v1/admin/observability/projects/:projectId/cost-visibility', async (c) => c.json(await api.setExecutionCostVisibility(await actor(c), project(c), await parseBody(c, SetExecutionCostVisibilitySchema))));
  return routes;
}
