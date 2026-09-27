import type { UserId } from '@crewstation/contracts';
import { CancelRuntimeImageOperationSchema, ProjectIdSchema, ResourceIdSchema, StartImageValidationSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams } from '@crewstation/http';
import { notFound } from '@crewstation/kernel';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { RuntimeEnvironmentModuleApi } from '../api/moduleApi';

const params = z.object({ projectId: ProjectIdSchema, id: ResourceIdSchema, versionId: ResourceIdSchema });
const validationParams = params.extend({ validationId: ResourceIdSchema });
const root = '/v1/projects/:projectId/runtime-images/:id/versions/:versionId';

export function runtimeImageVersionRoutes(api: RuntimeEnvironmentModuleApi, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const context = async (c: Context<AppEnv>) => {
    const p = parseParams(c, params), a = await actorFrom(c, (id) => isAdmin(id as UserId));
    const actor = { userId: a.userId as UserId, isAdmin: a.isAdmin };
    if ((await api.getVersion(actor, p.projectId, p.versionId)).imageId !== p.id) throw notFound('运行镜像版本', p.versionId);
    return { ...p, actor };
  };
  r.use(`${root}*`, async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  r.get('/v1/projects/:projectId/runtime-image-versions/:versionId', async (c) => {
    c.header('Cache-Control', 'no-store');
    const p = parseParams(c, params.omit({ id: true })), a = await actorFrom(c, (id) => isAdmin(id as UserId));
    const actor = { userId: a.userId as UserId, isAdmin: a.isAdmin }, version = await api.getVersion(actor, p.projectId, p.versionId);
    const image = await api.getImage(actor, p.projectId, version.imageId);
    return c.json({ ...version, name: image.name });
  });
  r.get('/v1/projects/:projectId/runtime-images/:id/versions/:versionId', async (c) => { const p = await context(c); return c.json(await api.getVersion(p.actor, p.projectId, p.versionId)); });
  r.post('/v1/projects/:projectId/runtime-images/:id/versions/:versionId/disable', async (c) => { const p = await context(c); return c.json(await api.disableVersion(p.actor, p.projectId, p.versionId)); });
  r.delete('/v1/projects/:projectId/runtime-images/:id/versions/:versionId', async (c) => { const p = await context(c); return c.json(await api.retireVersion(p.actor, p.projectId, p.versionId)); });
  r.get('/v1/projects/:projectId/runtime-images/:id/versions/:versionId/references', async (c) => { const p = await context(c); return c.json(await api.versionReferences(p.actor, p.projectId, p.versionId)); });
  r.post('/v1/projects/:projectId/runtime-images/:id/versions/:versionId/validations', async (c) => { const p = await context(c); return c.json(await api.startValidation(p.actor, p.projectId, p.versionId, await parseBody(c, StartImageValidationSchema)), 202); });
  r.get('/v1/projects/:projectId/runtime-images/:id/versions/:versionId/validations', async (c) => { const p = await context(c); return c.json({ items: await api.listValidations(p.actor, p.projectId, p.versionId) }); });
  r.get('/v1/projects/:projectId/runtime-images/:id/versions/:versionId/validations/:validationId', async (c) => { const p = await context(c); return c.json(await api.getValidation(p.actor, p.projectId, p.versionId, parseParams(c, validationParams).validationId)); });
  r.post('/v1/projects/:projectId/runtime-images/:id/versions/:versionId/validations/:validationId/cancel', async (c) => { const p = await context(c); return c.json(await api.cancelValidation(p.actor, p.projectId, p.versionId, parseParams(c, validationParams).validationId, (await parseBody(c, CancelRuntimeImageOperationSchema)).requestKey), 202); });
  return r;
}
