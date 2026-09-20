import type { ProfileTestId, UserId } from '@crewstation/contracts';
import {
  CopyComputeProfileRequestSchema, CreateComputeProfileRequestSchema, DeleteComputeProfileQuerySchema, ProfileTestIdSchema, SaveComputeProfileRequestSchema, SetComputeProfileEnabledRequestSchema,
  ResourceIdSchema, StartProfileTestRequestSchema,
} from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AgentRuntimeModuleApi } from '../api/moduleApi';

const idParams = z.object({ id: ResourceIdSchema });
const testParams = idParams.extend({ testId: ProfileTestIdSchema });

/** 算力档位管理接口（RFC-006 design §4.1）；服务端逐个裁定管理员身份，响应从不含凭据原值。 */
export function computeProfileAdminRoutes(api: AgentRuntimeModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  const profileId = (c: Context<AppEnv>) => parseParams(c, idParams).id;
  r.use('/v1/admin/compute-profiles*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  r.use('/v1/admin/runtime-images*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  r.get('/v1/admin/runtime-images', async (c) => c.json(await api.runtimeImages(await actor(c))));
  r.post('/v1/admin/runtime-images/credentials', async (c) => c.json(await api.issuePushCredential(await actor(c)), 201));
  r.get('/v1/admin/compute-profiles', async (c) => c.json(await api.listProfiles(await actor(c))));
  r.post('/v1/admin/compute-profiles', async (c) => c.json(await api.createProfile(await actor(c), await parseBody(c, CreateComputeProfileRequestSchema)), 201));
  r.get('/v1/admin/compute-profiles/:id', async (c) => c.json(await api.getProfile(await actor(c), profileId(c))));
  r.put('/v1/admin/compute-profiles/:id', async (c) => c.json(await api.saveProfile(await actor(c), profileId(c), await parseBody(c, SaveComputeProfileRequestSchema))));
  r.put('/v1/admin/compute-profiles/:id/enabled', async (c) => c.json(await api.setEnabled(await actor(c), profileId(c), (await parseBody(c, SetComputeProfileEnabledRequestSchema)).enabled)));
  r.put('/v1/admin/compute-profiles/:id/default-visible', async (c) => c.json(await api.setDefaultVisible(await actor(c), profileId(c), (await parseBody(c, z.object({ defaultVisible: z.boolean() }).strict())).defaultVisible)));
  r.put('/v1/admin/compute-profiles/:id/default', async (c) => c.json(await api.setDefault(await actor(c), profileId(c))));
  r.delete('/v1/admin/compute-profiles/:id', async (c) => {
    await api.removeProfile(await actor(c), profileId(c), parseQuery(c, DeleteComputeProfileQuerySchema).confirmReferences === 'true');
    return c.body(null, 204);
  });
  r.post('/v1/admin/compute-profiles/:id/copy', async (c) => c.json(await api.copyProfile(await actor(c), profileId(c), await parseBody(c, CopyComputeProfileRequestSchema)), 201));
  r.post('/v1/admin/compute-profiles/:id/tests', async (c) => c.json(await api.startTest(await actor(c), profileId(c), await parseBody(c, StartProfileTestRequestSchema)), 202));
  r.get('/v1/admin/compute-profiles/:id/tests/:testId', async (c) => { const p = parseParams(c, testParams); return c.json(await api.getTest(await actor(c), p.id, p.testId as ProfileTestId)); });
  return r;
}

/**
 * 平台镜像仓库主机的 ForwardAuth（RFC-006 §7.2）：挂在 cs-auth。Traefik 把原请求的方法与路径放在 X-Forwarded-* 头里；
 * 401 带 Basic 质询，Docker 客户端据此带上 docker login 保存的凭据重试。
 */
export function registryForwardAuthRoutes(api: AgentRuntimeModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/forward-auth/registry', (c) => {
    const verdict = api.authorizeRegistryRequest({
      method: c.req.header('x-forwarded-method') ?? 'GET', uri: c.req.header('x-forwarded-uri') ?? '/',
      ...(c.req.header('authorization') ? { authorization: c.req.header('authorization')! } : {}),
    });
    if (verdict.status === 200) return c.body(null, 200);
    if (verdict.status === 401) c.header('WWW-Authenticate', 'Basic realm="crewstation-registry"');
    c.header('Docker-Distribution-API-Version', 'registry/2.0');
    return c.json({ errors: [{ code: verdict.status === 401 ? 'UNAUTHORIZED' : 'DENIED', message: verdict.reason }] }, verdict.status);
  });
  return r;
}

/** 租户目录（沿用 RFC-001 的路径）：任何登录用户都能读投影，用于开发页与业务的档位下拉。 */
export function computeProfileCatalogRoutes(api: AgentRuntimeModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/catalog/compute-profiles', async (c) => c.json({ items: await api.listSummaries() }));
  return r;
}
