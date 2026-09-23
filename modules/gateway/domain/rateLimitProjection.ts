import type { ProjectId, RateLimits } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';

/** 平台接口限流的两个中间件（系统命名空间，控制台 `/v1` 的路由引用）。 */
export const PLATFORM_API_MIDDLEWARES = { rate: 'rate-limit-platform-api', inFlight: 'in-flight-platform-api' } as const;
/** 每个项目命名空间里的四个：用户域按用户、按主机合计；服务域按来源服务、按目标合计。 */
export const PROJECT_MIDDLEWARES = { user: 'rate-limit-user', host: 'rate-limit-host', source: 'rate-limit-source', target: 'rate-limit-target' } as const;
export const PLATFORM_POLICY_REF = 'platform';
export const projectPolicyRef = (projectId: string): string => `project:${projectId}`;

type Key = { readonly header: string } | { readonly host: true };
interface MiddlewareSpec {
  readonly namespace: string;
  readonly name: string;
  readonly rateLimit?: { readonly average: number; readonly burst: number; readonly key: Key };
  readonly inFlight?: { readonly amount: number; readonly key: Key };
}

/** 一条限流策略的期望（RFC-025 设计 §7.3）：子对象是它的 Middleware，期望里写每个中间件的桶与分桶方式，调和器照它渲染。 */
export interface RateLimitDeclaration {
  readonly kind: 'rate-limit-policy';
  readonly ref: string;
  readonly projectId?: ProjectId;
  readonly spec: { readonly children: readonly { readonly kind: 'Middleware'; readonly namespace: string; readonly name: string }[]; readonly middlewares: readonly MiddlewareSpec[] };
  readonly display: Readonly<Record<string, string>>;
}

const byUser: Key = { header: IDENTITY_HEADERS.userId }, bySource: Key = { header: IDENTITY_HEADERS.sourceService }, byHost: Key = { host: true };
const declaration = (ref: string, middlewares: readonly MiddlewareSpec[], display: Record<string, string>, projectId?: ProjectId): RateLimitDeclaration => ({
  kind: 'rate-limit-policy', ref, ...(projectId ? { projectId } : {}),
  spec: { children: middlewares.map((entry) => ({ kind: 'Middleware', namespace: entry.namespace, name: entry.name })), middlewares }, display,
});
const bucket = (limit: { readonly average: number; readonly burst: number }) => `${limit.average}/s·${limit.burst}`;

/** 平台一条：平台接口按登录用户一只桶，另有每人的并发上限（链在 ForwardAuth 之后，身份头一定在）。 */
export function platformRateLimitPolicy(limits: RateLimits['platformApi'], systemNamespace: string): RateLimitDeclaration {
  return declaration(PLATFORM_POLICY_REF, [
    { namespace: systemNamespace, name: PLATFORM_API_MIDDLEWARES.rate, rateLimit: { ...limits.perUser, key: byUser } },
    { namespace: systemNamespace, name: PLATFORM_API_MIDDLEWARES.inFlight, inFlight: { amount: limits.inFlightPerUser, key: byUser } },
  ], { scope: 'platform', perUser: bucket(limits.perUser), inFlightPerUser: String(limits.inFlightPerUser) });
}

/** 每个项目一条：生效的用户域与服务域（覆盖＋平台默认），中间件建在项目命名空间。 */
export function projectRateLimitPolicy(project: { readonly projectId: ProjectId; readonly namespace: string }, limits: Pick<RateLimits, 'userDomain' | 'serviceDomain'>, overridden: boolean): RateLimitDeclaration {
  const at = project.namespace;
  return declaration(projectPolicyRef(project.projectId), [
    { namespace: at, name: PROJECT_MIDDLEWARES.user, rateLimit: { ...limits.userDomain.perUser, key: byUser } },
    { namespace: at, name: PROJECT_MIDDLEWARES.host, rateLimit: { ...limits.userDomain.perHost, key: byHost } },
    { namespace: at, name: PROJECT_MIDDLEWARES.source, rateLimit: { ...limits.serviceDomain.perSource, key: bySource } },
    { namespace: at, name: PROJECT_MIDDLEWARES.target, rateLimit: { ...limits.serviceDomain.perTarget, key: byHost } },
  ], {
    scope: 'project', override: overridden ? 'true' : 'false', userPerUser: bucket(limits.userDomain.perUser), userPerHost: bucket(limits.userDomain.perHost),
    servicePerSource: bucket(limits.serviceDomain.perSource), servicePerTarget: bucket(limits.serviceDomain.perTarget),
  }, project.projectId);
}
