import { CreateRuntimeImageSetupSchema } from '@crewstation/contracts';
import { RuntimeImageHistoryQuerySchema } from '@crewstation/contracts';
import type { UserId } from '@crewstation/contracts';
import {
  CancelRuntimeImageOperationSchema, CreateRuntimeImageRequestSchema, CreateRuntimeImageRevisionSchema, ProjectIdSchema,
  ResourceIdSchema, RuntimeImageLogQuerySchema, RuntimeImagePageQuerySchema, ShareRuntimeImageSchema, StartRuntimeImageBuildSchema, UpdateRuntimeImageRequestSchema,
} from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { RuntimeEnvironmentModuleApi } from '../api/moduleApi';

const projectParams = z.object({ projectId: ProjectIdSchema });
const imageParams = projectParams.extend({ id: ResourceIdSchema });
const buildParams = imageParams.extend({ buildId: ResourceIdSchema });
const root = '/v1/projects/:projectId/runtime-images';

export function runtimeImageRoutes(api: RuntimeEnvironmentModuleApi, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  r.use(`${root}*`, async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  r.get('/v1/projects/:projectId/runtime-images', async (c) => c.json({ items: await api.listImages(await actor(c), parseParams(c, projectParams).projectId, parseQuery(c, RuntimeImagePageQuerySchema)) }));
  r.post('/v1/projects/:projectId/runtime-images/setup', async (c) => c.json(await api.createSetup(await actor(c), parseParams(c, projectParams).projectId, await parseBody(c, CreateRuntimeImageSetupSchema)), 201));
  r.post('/v1/projects/:projectId/runtime-images', async (c) => c.json(await api.createImage(await actor(c), parseParams(c, projectParams).projectId, await parseBody(c, CreateRuntimeImageRequestSchema)), 201));
  r.get('/v1/projects/:projectId/runtime-images/:id', async (c) => { const p = parseParams(c, imageParams); return c.json(await api.getImage(await actor(c), p.projectId, p.id)); });
  r.get('/v1/projects/:projectId/runtime-images/:id/history', async (c) => { const p = parseParams(c, imageParams); return c.json(await api.imageHistory(await actor(c), p.projectId, p.id, parseQuery(c, RuntimeImageHistoryQuerySchema))); });
  r.patch('/v1/projects/:projectId/runtime-images/:id', async (c) => { const p = parseParams(c, imageParams); return c.json(await api.updateImage(await actor(c), p.projectId, p.id, await parseBody(c, UpdateRuntimeImageRequestSchema))); });
  r.post('/v1/projects/:projectId/runtime-images/:id/share', async (c) => { const p = parseParams(c, imageParams), b = await parseBody(c, ShareRuntimeImageSchema); return c.json(await api.shareImage(await actor(c), p.projectId, p.id, b.scope, b.expectedRevision)); });
  r.post('/v1/projects/:projectId/runtime-images/:id/revisions', async (c) => { const p = parseParams(c, imageParams); return c.json(await api.createRevision(await actor(c), p.projectId, p.id, await parseBody(c, CreateRuntimeImageRevisionSchema)), 201); });
  r.get('/v1/projects/:projectId/runtime-images/:id/revisions', async (c) => { const p = parseParams(c, imageParams); return c.json({ items: await api.listRevisions(await actor(c), p.projectId, p.id, parseQuery(c, RuntimeImagePageQuerySchema)) }); });
  r.get('/v1/projects/:projectId/runtime-images/:id/versions', async (c) => { const p = parseParams(c, imageParams); return c.json({ items: await api.listVersions(await actor(c), p.projectId, p.id, parseQuery(c, RuntimeImagePageQuerySchema)) }); });
  r.post('/v1/projects/:projectId/runtime-images/:id/builds', async (c) => { const p = parseParams(c, imageParams); return c.json(await api.startBuild(await actor(c), p.projectId, p.id, await parseBody(c, StartRuntimeImageBuildSchema)), 202); });
  r.get('/v1/projects/:projectId/runtime-images/:id/builds', async (c) => { const p = parseParams(c, imageParams); return c.json({ items: await api.listBuilds(await actor(c), p.projectId, p.id, parseQuery(c, RuntimeImagePageQuerySchema)) }); });
  r.get('/v1/projects/:projectId/runtime-images/:id/builds/:buildId', async (c) => { const p = parseParams(c, buildParams); return c.json(await api.getBuild(await actor(c), p.projectId, p.id, p.buildId)); });
  r.post('/v1/projects/:projectId/runtime-images/:id/builds/:buildId/cancel', async (c) => { const p = parseParams(c, buildParams), b = await parseBody(c, CancelRuntimeImageOperationSchema); return c.json(await api.cancelBuild(await actor(c), p.projectId, p.id, p.buildId, b.requestKey), 202); });
  r.get('/v1/projects/:projectId/runtime-images/:id/builds/:buildId/logs', async (c) => {
    const p = parseParams(c, buildParams), result = await api.buildLogs(await actor(c), p.projectId, p.id, p.buildId, parseQuery(c, RuntimeImageLogQuerySchema));
    return result.expired ? c.json({ error: 'logs_expired', message: '构建日志已过保留期', expiresAt: result.expiresAt }, 410) : c.json(result);
  });
  r.get('/v1/admin/runtime-image-catalog', async (c) => { c.header('Cache-Control', 'no-store'); return c.json({ items: await api.adminCatalog(await actor(c), parseQuery(c, RuntimeImagePageQuerySchema)) }); });
  return r;
}
