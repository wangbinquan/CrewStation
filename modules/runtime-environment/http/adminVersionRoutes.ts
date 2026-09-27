import type { UserId } from '@crewstation/contracts';
import { CancelRuntimeImageOperationSchema, ProjectIdSchema, ResourceIdSchema, StartImageValidationSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams } from '@crewstation/http';
import { forbidden, notFound } from '@crewstation/kernel';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { RuntimeEnvironmentModuleApi } from '../api/moduleApi';

const root = '/v1/admin/runtime-image-catalog/:id/versions/:versionId';
const params = z.object({ id: ResourceIdSchema, versionId: ResourceIdSchema });
const validationParams = params.extend({ validationId: ResourceIdSchema });
const start = StartImageValidationSchema.extend({ projectId: ProjectIdSchema });

export function adminRuntimeImageVersionRoutes(api: RuntimeEnvironmentModuleApi, isAdmin: (id: UserId) => Promise<boolean>) {
  const r = new Hono<AppEnv>();
  const context = async (c: Context<AppEnv>) => {
    const raw = await actorFrom(c, (id) => isAdmin(id as UserId));
    if (!raw.isAdmin) throw forbidden('只有平台管理员可以管理运行镜像');
    const actor = { ...raw, userId: raw.userId as UserId }, p = parseParams(c, params);
    if ((await api.getVersion(actor, undefined, p.versionId)).imageId !== p.id) throw notFound('运行镜像版本', p.versionId);
    return { ...p, actor };
  };
  r.use(`${root}*`, async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  r.get('/v1/admin/runtime-image-catalog/:id/versions/:versionId', async (c) => { const p = await context(c); return c.json(await api.getVersion(p.actor, undefined, p.versionId)); });
  r.post('/v1/admin/runtime-image-catalog/:id/versions/:versionId/disable', async (c) => { const p = await context(c); return c.json(await api.disableVersion(p.actor, undefined, p.versionId)); });
  r.delete('/v1/admin/runtime-image-catalog/:id/versions/:versionId', async (c) => { const p = await context(c); return c.json(await api.retireVersion(p.actor, undefined, p.versionId)); });
  r.get('/v1/admin/runtime-image-catalog/:id/versions/:versionId/references', async (c) => { const p = await context(c); return c.json(await api.versionReferences(p.actor, undefined, p.versionId)); });
  r.get('/v1/admin/runtime-image-catalog/:id/versions/:versionId/validations', async (c) => { const p = await context(c); return c.json({ items: await api.listValidations(p.actor, undefined, p.versionId) }); });
  r.post('/v1/admin/runtime-image-catalog/:id/versions/:versionId/validations', async (c) => { const p = await context(c), body = await parseBody(c, start); return c.json(await api.startValidation(p.actor, body.projectId, p.versionId, { target: body.target, requestKey: body.requestKey }), 202); });
  r.get('/v1/admin/runtime-image-catalog/:id/versions/:versionId/validations/:validationId', async (c) => { const p = await context(c); return c.json(await api.getValidation(p.actor, undefined, p.versionId, parseParams(c, validationParams).validationId)); });
  r.post('/v1/admin/runtime-image-catalog/:id/versions/:versionId/validations/:validationId/cancel', async (c) => { const p = await context(c); return c.json(await api.cancelValidation(p.actor, undefined, p.versionId, parseParams(c, validationParams).validationId, (await parseBody(c, CancelRuntimeImageOperationSchema)).requestKey), 202); });
  return r;
}
