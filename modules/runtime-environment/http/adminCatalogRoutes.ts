import type { UserId } from '@crewstation/contracts';
import { CancelRuntimeImageOperationSchema, CreateRuntimeImageRequestSchema, CreateRuntimeImageRevisionSchema, CreateRuntimeImageSetupSchema, ResourceIdSchema, RuntimeImageHistoryQuerySchema, RuntimeImageLogQuerySchema, RuntimeImagePageQuerySchema, StartRuntimeImageBuildSchema, UpdateRuntimeImageRequestSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import { forbidden } from '@crewstation/kernel';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { RuntimeEnvironmentModuleApi } from '../api/moduleApi';

const root = '/v1/admin/runtime-image-catalog', imageParams = z.object({ id: ResourceIdSchema }), buildParams = imageParams.extend({ buildId: ResourceIdSchema });

/** 平台目录管理不携带消费项目；来源业务只出现在配方中。 */
export function adminRuntimeImageCatalogRoutes(api: RuntimeEnvironmentModuleApi, isAdmin: (id: UserId) => Promise<boolean>) {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => {
    const value = await actorFrom(c, (id) => isAdmin(id as UserId));
    if (!value.isAdmin) throw forbidden('只有平台管理员可以管理运行镜像');
    return { ...value, userId: value.userId as UserId };
  };
  r.use(`${root}*`, async (c, next) => { c.header('Cache-Control', 'no-store'); await actor(c); await next(); });
  r.get('/v1/admin/runtime-image-catalog', async (c) => c.json({ items: await api.adminCatalog(await actor(c), parseQuery(c, RuntimeImagePageQuerySchema)) }));
  r.post('/v1/admin/runtime-image-catalog', async (c) => c.json(await api.createImage(await actor(c), undefined, await parseBody(c, CreateRuntimeImageRequestSchema)), 201));
  r.post('/v1/admin/runtime-image-catalog/setup', async (c) => c.json(await api.createSetup(await actor(c), undefined, await parseBody(c, CreateRuntimeImageSetupSchema)), 201));
  r.get('/v1/admin/runtime-image-catalog/:id', async (c) => c.json(await api.getImage(await actor(c), undefined, parseParams(c, imageParams).id)));
  r.get('/v1/admin/runtime-image-catalog/:id/grants', async (c) => c.json(await api.imageGrants(await actor(c), parseParams(c, imageParams).id)));
  r.patch('/v1/admin/runtime-image-catalog/:id', async (c) => c.json(await api.updateImage(await actor(c), undefined, parseParams(c, imageParams).id, await parseBody(c, UpdateRuntimeImageRequestSchema))));
  r.get('/v1/admin/runtime-image-catalog/:id/history', async (c) => c.json(await api.imageHistory(await actor(c), undefined, parseParams(c, imageParams).id, parseQuery(c, RuntimeImageHistoryQuerySchema))));
  r.get('/v1/admin/runtime-image-catalog/:id/revisions', async (c) => c.json({ items: await api.listRevisions(await actor(c), undefined, parseParams(c, imageParams).id, parseQuery(c, RuntimeImagePageQuerySchema)) }));
  r.post('/v1/admin/runtime-image-catalog/:id/revisions', async (c) => c.json(await api.createRevision(await actor(c), undefined, parseParams(c, imageParams).id, await parseBody(c, CreateRuntimeImageRevisionSchema)), 201));
  r.get('/v1/admin/runtime-image-catalog/:id/versions', async (c) => c.json({ items: await api.listVersions(await actor(c), undefined, parseParams(c, imageParams).id, parseQuery(c, RuntimeImagePageQuerySchema)) }));
  r.get('/v1/admin/runtime-image-catalog/:id/builds', async (c) => c.json({ items: await api.listBuilds(await actor(c), undefined, parseParams(c, imageParams).id, parseQuery(c, RuntimeImagePageQuerySchema)) }));
  r.post('/v1/admin/runtime-image-catalog/:id/builds', async (c) => c.json(await api.startBuild(await actor(c), undefined, parseParams(c, imageParams).id, await parseBody(c, StartRuntimeImageBuildSchema)), 202));
  r.get('/v1/admin/runtime-image-catalog/:id/builds/:buildId', async (c) => { const p = parseParams(c, buildParams); return c.json(await api.getBuild(await actor(c), undefined, p.id, p.buildId)); });
  r.post('/v1/admin/runtime-image-catalog/:id/builds/:buildId/cancel', async (c) => { const p = parseParams(c, buildParams); return c.json(await api.cancelBuild(await actor(c), undefined, p.id, p.buildId, (await parseBody(c, CancelRuntimeImageOperationSchema)).requestKey), 202); });
  r.get('/v1/admin/runtime-image-catalog/:id/builds/:buildId/logs', async (c) => {
    const p = parseParams(c, buildParams), result = await api.buildLogs(await actor(c), undefined, p.id, p.buildId, parseQuery(c, RuntimeImageLogQuerySchema));
    return result.expired ? c.json({ error: 'logs_expired', message: '构建日志已过保留期', expiresAt: result.expiresAt }, 410) : c.json(result);
  });
  return r;
}
