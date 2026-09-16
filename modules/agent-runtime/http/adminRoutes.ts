import type { RuntimeCheckId, RuntimeConfigId, UserId } from '@crewstation/contracts';
import { ActivateRuntimeConfigRequestSchema, CreateRuntimeConfigRequestSchema, DisableRuntimeConfigRequestSchema, RuntimeCheckIdSchema, RuntimeConfigIdSchema, RuntimeConfigListQuerySchema, SaveRuntimeDraftRequestSchema, StartRuntimeCheckRequestSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AgentRuntimeModuleApi } from '../api/moduleApi';

const idParams = z.object({ id: RuntimeConfigIdSchema });
const checkParams = idParams.extend({ checkId: RuntimeCheckIdSchema });

/** 管理员运行环境接口（RFC-004 §4）；服务端逐个裁定管理员身份，响应从不含凭据原值。 */
export function agentRuntimeAdminRoutes(api: AgentRuntimeModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  r.use('/v1/admin/agent-runtime-configs*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  r.get('/v1/admin/agent-runtime-configs', async (c) => c.json(await api.listConfigs(await actor(c), parseQuery(c, RuntimeConfigListQuerySchema))));
  r.post('/v1/admin/agent-runtime-configs', async (c) => c.json(await api.createConfig(await actor(c), await parseBody(c, CreateRuntimeConfigRequestSchema)), 201));
  r.get('/v1/admin/agent-runtime-configs/:id', async (c) => c.json(await api.getConfig(await actor(c), parseParams(c, idParams).id as RuntimeConfigId)));
  r.put('/v1/admin/agent-runtime-configs/:id/draft', async (c) => c.json(await api.saveDraft(await actor(c), parseParams(c, idParams).id as RuntimeConfigId, await parseBody(c, SaveRuntimeDraftRequestSchema))));
  r.post('/v1/admin/agent-runtime-configs/:id/checks', async (c) => c.json(await api.startCheck(await actor(c), parseParams(c, idParams).id as RuntimeConfigId, await parseBody(c, StartRuntimeCheckRequestSchema)), 202));
  r.get('/v1/admin/agent-runtime-configs/:id/checks/:checkId', async (c) => { const p = parseParams(c, checkParams); return c.json(await api.getCheck(await actor(c), p.id as RuntimeConfigId, p.checkId as RuntimeCheckId)); });
  r.post('/v1/admin/agent-runtime-configs/:id/activate', async (c) => c.json(await api.activate(await actor(c), parseParams(c, idParams).id as RuntimeConfigId, await parseBody(c, ActivateRuntimeConfigRequestSchema))));
  r.post('/v1/admin/agent-runtime-configs/:id/disable', async (c) => c.json(await api.disable(await actor(c), parseParams(c, idParams).id as RuntimeConfigId, await parseBody(c, DisableRuntimeConfigRequestSchema))));
  return r;
}
