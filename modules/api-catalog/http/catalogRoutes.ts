import type { ServiceId } from '@crewstation/contracts';
import { ServiceIdSchema, SetOpenPolicyRequestSchema, SlugSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiCatalogModuleApi } from '../api/moduleApi';
import { actorFrom } from './actor';

const serviceQuery = z.object({ serviceId: ServiceIdSchema.optional() });
const requiredServiceQuery = z.object({ serviceId: ServiceIdSchema });
/** 操作键含 `/`，路径参数按 URL 编码传入，Hono 解码后得到原键。 */
const keyParams = z.object({ key: z.string().min(1) });

/** 目录：读对所有登录用户开放，开放策略只有管理员能改。 */
export function catalogRoutes(api: ApiCatalogModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/catalog/operations', async (c) => {
    const { serviceId } = parseQuery(c, serviceQuery);
    return c.json({ items: await api.listOperations(await actorFrom(c, api), serviceId as ServiceId | undefined) });
  });
  r.get('/v1/catalog/proxies', async (c) => c.json({ items: await api.listProxies(await actorFrom(c, api)) }));
  r.get('/v1/catalog/proxies/:proxy/openapi', async (c) => {
    const { proxy } = parseParams(c, z.object({ proxy: SlugSchema }));
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
