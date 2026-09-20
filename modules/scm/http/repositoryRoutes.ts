import type { ServiceId } from '@crewstation/contracts';
import { ListBranchesQuerySchema, ManifestUpgradeRequestSchema, ServiceIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, parseQuery } from '@crewstation/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ActorResolver, ScmModuleApi } from '../api/moduleApi';
import { actorFrom } from './actor';

const serviceParams = z.object({ serviceId: ServiceIdSchema });
const serviceIdOf = (c: Context<AppEnv>): ServiceId => parseParams(c, serviceParams).serviceId as ServiceId;

/** 只读查询；建仓、打标、凭据签发由控制面与发布流程经 api 调用，不在这里暴露。 */
export function repositoryRoutes(api: Pick<ScmModuleApi, 'listTemplates' | 'getBinding' | 'listBranches' | 'listTags' | 'previewManifestUpgrade'>, resolveActor: ActorResolver): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/catalog/project-templates', async (c) => c.json({ items: await api.listTemplates(await actorFrom(c, resolveActor)) }));
  r.get('/v1/services/:serviceId/repository', async (c) => c.json(await api.getBinding(await actorFrom(c, resolveActor), serviceIdOf(c))));
  r.post('/v1/services/:serviceId/manifest-upgrade', async (c) => {
    const input = await parseBody(c, ManifestUpgradeRequestSchema);
    return c.json(await api.previewManifestUpgrade(await actorFrom(c, resolveActor), serviceIdOf(c), input.content));
  });
  r.get('/v1/services/:serviceId/branches', async (c) =>
    c.json({ items: await api.listBranches(await actorFrom(c, resolveActor), serviceIdOf(c), parseQuery(c, ListBranchesQuerySchema)) }));
  r.get('/v1/services/:serviceId/tags', async (c) => c.json({ items: await api.listTags(await actorFrom(c, resolveActor), serviceIdOf(c)) }));
  return r;
}
