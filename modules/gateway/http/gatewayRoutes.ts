import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { requireUser } from '@crewstation/http';
import { forbidden } from '@crewstation/kernel';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { GatewayModuleApi } from '../api/moduleApi';

/** 管理员视角：当前路由表、放行表与手动重算。 */
export function gatewayRoutes(api: GatewayModuleApi, isAdmin: (userId: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const admin = async (c: Context<AppEnv>): Promise<void> => {
    if (!(await isAdmin(requireUser(c).userId as UserId))) throw forbidden('只有管理员可以查看网关状态');
  };
  r.get('/v1/gateway/routes', async (c) => { await admin(c); return c.json({ items: await api.listRoutes() }); });
  r.get('/v1/gateway/allowlist', async (c) => { await admin(c); return c.json((await api.currentAllowlist()) ?? { version: 0, entries: [], defaultOpen: [] }); });
  r.post('/v1/gateway/reconcile', async (c) => { await admin(c); return c.json({ routes: await api.reconcileAll(), allowlist: (await api.rebuildAllowlist()).version }); });
  return r;
}
