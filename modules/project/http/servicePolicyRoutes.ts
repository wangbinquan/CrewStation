import { ProjectIdSchema, SaveProjectServicePolicySchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody } from '@crewstation/http';
import { Hono } from 'hono';
import type { ProjectModuleApi } from '../api/moduleApi';
import { actorFrom } from './actor';

export function servicePolicyRoutes(api: ProjectModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/projects/:projectId/service-policy', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    return c.json(await api.getServicePolicy(await actorFrom(c, api), ProjectIdSchema.parse(c.req.param('projectId'))));
  });
  r.put('/v1/projects/:projectId/service-policy', async (c) => c.json(await api.saveServicePolicy(await actorFrom(c, api), ProjectIdSchema.parse(c.req.param('projectId')), await parseBody(c, SaveProjectServicePolicySchema))));
  return r;
}
