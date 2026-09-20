import type { ServiceId } from '@crewstation/contracts';
import { ServiceIdSchema, SetOpenPolicyRequestSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiCatalogModuleApi } from '../api/moduleApi';
import { actorFrom } from './actor';

const serviceQuery = z.object({ serviceId: ServiceIdSchema.optional() });
const requiredServiceQuery = z.object({ serviceId: ServiceIdSchema });
/** 操作键含 `/`，路径参数按 URL 编码传入，Hono 解码后得到原键。 */
const keyParams = z.object({ key: ResourceIdSchema });

/** 目录：读对所有登录用户开放，开放策略只有管理员能改。 */
export function catalogRoutes(api: ApiCatalogModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/catalog/operations', async (c) => {
    const { serviceId } = parseQuery(c, serviceQuery);
    return c.json({ items: await api.listOperations(await actorFrom(c, api), serviceId as ServiceId | undefined) });
  });
  r.get('/v1/catalog/proxies', async (c) => c.json({ items: await api.listProxies(await actorFrom(c, api)) }));
  r.put('/v1/catalog/proxies/:proxy/name', async (c) => {
    const { proxy } = parseParams(c, z.object({ proxy: ResourceIdSchema }));
    const { name } = await parseBody(c, z.object({ name: z.string().trim().min(1).max(80) }).strict());
    return c.json(await api.renameProxy(await actorFrom(c, api), proxy, name));
  });
  r.get('/v1/catalog/proxies/:proxy/openapi', async (c) => {
    const { proxy } = parseParams(c, z.object({ proxy: ResourceIdSchema }));
    const { serviceId } = parseQuery(c, requiredServiceQuery);
    return c.json(await api.prunedOpenApi(await actorFrom(c, api), serviceId as ServiceId, proxy));
  });
  r.put('/v1/catalog/operations/:key/policy', async (c) => {
    const { key } = parseParams(c, keyParams);
    const { openPolicy } = await parseBody(c, SetOpenPolicyRequestSchema);
    return c.json(await api.setOpenPolicy(await actorFrom(c, api), key, openPolicy));
  });
  return r;
}
