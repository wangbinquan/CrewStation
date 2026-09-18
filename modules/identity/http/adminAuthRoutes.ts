import type { OidcProviderId, ProjectId, UserId } from '@crewstation/contracts';
import { OidcProviderIdSchema, ProjectIdSchema, UpdateLoginPolicyRequestSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams, requireUser } from '@crewstation/http';
import { validation } from '@crewstation/kernel';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthAdminActor, IdentityModuleApi } from '../api/moduleApi';

const providerParams = z.object({ id: OidcProviderIdSchema });
const projectParams = z.object({ projectId: ProjectIdSchema });

/**
 * 管理面（cs-api）：登录策略、身份提供方与身份转发。
 * 调用者的管理员标记由 identity 自己回答，认证方式来自 ForwardAuth 注入的平台内部头——
 * 关闭常规登录要求「当前会话来自 OIDC」，就落在这条链上（RFC-005 §6.1、§7.1）。
 */
export function adminAuthRoutes(api: IdentityModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>): Promise<AuthAdminActor> => {
    const user = requireUser(c);
    return { userId: user.userId as UserId, isAdmin: await api.isAdmin(user.userId as UserId), authMethod: user.authMethod };
  };
  // 登录策略与提供方配置都不该被任何中间层缓存：管理员改完必须立刻看到新状态。
  r.use('/v1/admin/auth/*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  // 请求体由用例按契约 Schema 逐字段校验，这里只负责「不是 JSON 就是 400 而不是 500」。
  const body = async (c: Context<AppEnv>): Promise<unknown> => {
    try {
      return await body(c);
    } catch {
      throw validation('请求体必须是 JSON');
    }
  };

  r.get('/v1/admin/auth/login-policy', async (c) => c.json(await api.readLoginPolicy(await actor(c))));
  r.put('/v1/admin/auth/login-policy', async (c) => {
    const { passwordLoginEnabled } = await parseBody(c, UpdateLoginPolicyRequestSchema);
    return c.json(await api.setPasswordLoginEnabled(await actor(c), passwordLoginEnabled));
  });

  r.get('/v1/admin/auth/providers', async (c) => c.json({ items: await api.listProviders(await actor(c)) }));
  r.post('/v1/admin/auth/providers', async (c) => c.json(await api.createProvider(await actor(c), await body(c)), 201));
  r.get('/v1/admin/auth/providers/:id', async (c) => c.json(await api.getProvider(await actor(c), parseParams(c, providerParams).id as OidcProviderId)));
  r.patch('/v1/admin/auth/providers/:id', async (c) => c.json(await api.patchProvider(await actor(c), parseParams(c, providerParams).id as OidcProviderId, await body(c))));
  r.delete('/v1/admin/auth/providers/:id', async (c) => {
    await api.removeProvider(await actor(c), parseParams(c, providerParams).id as OidcProviderId);
    return c.body(null, 204);
  });
  r.post('/v1/admin/auth/providers/:id/test', async (c) => c.json(await api.probeProvider(await actor(c), parseParams(c, providerParams).id as OidcProviderId)));

  r.get('/v1/admin/auth/forwarding', async (c) => c.json(await api.readForwarding(await actor(c))));
  r.put('/v1/admin/auth/forwarding', async (c) => {
    await api.setGlobalForwarding(await actor(c), await body(c));
    return c.json(await api.readForwarding(await actor(c)));
  });
  r.put('/v1/admin/auth/forwarding/projects/:projectId', async (c) => {
    const { projectId } = parseParams(c, projectParams);
    await api.setProjectForwarding(await actor(c), projectId as ProjectId, await body(c));
    return c.json(await api.effectiveForwarding(projectId as ProjectId));
  });
  r.delete('/v1/admin/auth/forwarding/projects/:projectId', async (c) => {
    const { projectId } = parseParams(c, projectParams);
    await api.clearProjectForwarding(await actor(c), projectId as ProjectId);
    return c.json(await api.effectiveForwarding(projectId as ProjectId));
  });
  // 项目负责人只读：本项目实际会收到的头与声明，与能力说明页同一份数据。
  r.get('/v1/projects/:projectId/identity-forwarding', async (c) => {
    requireUser(c);
    return c.json(await api.effectiveForwarding(parseParams(c, projectParams).projectId as ProjectId));
  });
  return r;
}
