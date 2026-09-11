// 装配：identity 运行面 + project（提供 preview 访问权与成员关系）。进程知道拓扑，模块不知道。
import type { Actor } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { Logger } from '@crewstation/kernel';
import type { AllowlistEvaluator, IdentityProvider, MembershipLookup, PreviewAccess, WorkloadLookup } from '@crewstation/module-identity';
import { createIdentityModule, demoIdentityProvider } from '@crewstation/module-identity';
import type { ProjectModuleApi } from '@crewstation/module-project';
import { createProjectModule } from '@crewstation/module-project';
import type { Database } from '@crewstation/persistence';
import type { Hono } from 'hono';
import type { AuthSettings } from './settings';

export interface Assembly {
  routers: Hono<AppEnv>[];
}

/**
 * gateway 模块（L5）接入前的占位实现，名字里的 Pending 就是提醒替换：
 * 任何源 IP 都视为未登记、任何服务域调用都拒绝，因此服务域在 gateway 到位前整体不可用而不是不设防。
 */
export const gatewayPendingWorkloadLookup: WorkloadLookup = { byIp: async () => undefined };
export const gatewayPendingAllowlistEvaluator: AllowlistEvaluator = {
  evaluate: async (_caller, target) => ({ allowed: false, reason: 'gateway 模块尚未接入：Pod 身份索引与放行表不可用', targetIdentity: target.host }),
};

export function assembleModules(db: Database, settings: AuthSettings, logger: Logger): Assembly {
  // identity 先于 project 装配，而 project 又依赖 identity.api；对 project 的引用在请求时才取用。
  const holder: { api?: ProjectModuleApi } = {};
  const project = (): ProjectModuleApi => {
    if (!holder.api) throw new Error('project 模块尚未装配完成');
    return holder.api;
  };
  const identity = createIdentityModule({
    db,
    logger,
    settings: {
      adminEmails: settings.adminEmails,
      userDomain: settings.userDomain,
      cookieDomain: settings.cookieDomain,
      secure: settings.secure,
      sessionTtlSeconds: settings.sessionTtlSeconds,
    },
    provider: providerFor(settings),
    previewAccess: previewAccessFrom(project),
    membershipLookup: membershipsFrom(project),
    workloadLookup: gatewayPendingWorkloadLookup,
    allowlistEvaluator: gatewayPendingAllowlistEvaluator,
  });
  holder.api = createProjectModule({
    db,
    identity: identity.api,
    hosts: {
      prodHost: (slug) => `${slug}.${settings.userDomain}`,
      previewHost: (slug) => `preview.${slug}.${settings.userDomain}`,
      serviceHost: (name) => `${name}.${settings.serviceDomain}`,
    },
    settings: { defaultMaxConcurrentTasks: settings.defaultMaxConcurrentTasks, defaultServicePlan: settings.defaultServicePlan },
  }).api;
  return { routers: [...identity.http.auth, ...identity.http.forwardAuth] };
}

function providerFor(settings: AuthSettings): IdentityProvider {
  if (settings.identityProvider === 'demo') return demoIdentityProvider();
  throw new Error('OIDC 身份提供者尚未实现；本地演示请设置 CS_IDENTITY_PROVIDER=demo');
}

/** preview 与 dev 主机：项目成员（含负责人、开发者、测试者）或管理员可见；首版服务身份为 `<slug>/<slug>`。 */
function previewAccessFrom(project: () => ProjectModuleApi): PreviewAccess {
  return {
    canView: async (userId, projectSlug) => {
      const api = project();
      const resolved = await api.resolveServiceIdentity(`${projectSlug}/${projectSlug}`);
      if (!resolved) return false;
      const actor: Actor = { userId, isAdmin: await api.isAdmin(userId) };
      return (await api.roleOf(actor, resolved.projectId)) !== undefined;
    },
  };
}

/** 成员关系按普通成员视角查询（isAdmin=false），这样管理员也只得到自己真实加入的项目。 */
function membershipsFrom(project: () => ProjectModuleApi): MembershipLookup {
  return {
    membershipsOf: async (userId) => {
      const api = project();
      const actor: Actor = { userId, isAdmin: false };
      const projects = await api.listProjects(actor);
      const roles = await Promise.all(projects.map(async (p) => ({ projectId: p.id, role: await api.roleOf(actor, p.id) })));
      return roles.flatMap((m) => (m.role === undefined || m.role === 'admin' ? [] : [{ projectId: m.projectId, role: m.role }]));
    },
  };
}
