import { IDENTITY_HEADERS, PLATFORM_INTERNAL_HEADERS, TOKEN_CLAIMS } from '@crewstation/contracts';
import type { UserDto } from '@crewstation/contracts';
import type { UserAuthDecision, UserAuthRequest } from '../api/moduleApi';
import { acceptsHtml, firstHost, headerSafe, originalUrl } from '../domain/forwardedRequest';
import type { ResolvedHost } from '../domain/hosts';
import type { IdentityProfile } from '../domain/identityForwarding';
import { forwardedHeaders, forwardedTokenClaims } from '../domain/identityForwarding';
import { CONSOLE_AUDIENCE, IDENTITY_TOKEN_TTL_SECONDS, loginUrl, schemeOf, serviceAudience, userSubject } from '../domain/session';
import type { IdentityUseCaseDeps } from './dependencies';
import type { forwardingUseCases } from './oidc/forwardingAdmin';
import { sessionTokenUseCases } from './sessionTokens';

type Deps = Pick<IdentityUseCaseDeps, 'tokens' | 'users' | 'session' | 'clock' | 'hosts' | 'previewAccess' | 'appAccess' | 'uow' | 'projects' | 'serviceEntry'>;

/** 只有固定三项之外的字段才需要去查身份档案；默认配置（显示名＋邮箱）下这条路一次库都不多查。 */
const FIXED_FIELDS = new Set(['name', 'email', 'git-name']);

/**
 * 用户域 ForwardAuth（Design §7.1）：Cookie 会话 → 用户 → 目标主机 → preview／dev 的访问权与正式地址的使用权 → 绑定目标 aud 的身份令牌。
 * 注入的身份字段由平台的「身份转发」配置决定（RFC-005 §7.2）：不在生效集里的字段既不给头也不进令牌声明。
 * 未登录的浏览器导航跳转登录页并带原始地址；非浏览器请求回 401。
 */
export function forwardAuthUserUseCase(deps: Deps, forwarding: Pick<ReturnType<typeof forwardingUseCases>, 'effectiveForwardingForSlug'>) {
  const { resolveSessionDetail } = sessionTokenUseCases(deps);
  const { effectiveForwardingForSlug } = forwarding;
  return async (request: UserAuthRequest): Promise<UserAuthDecision> => {
    const scheme = schemeOf(deps.session, request.scheme);
    const host = firstHost(request.host);
    const challenge = (message: string): UserAuthDecision =>
      acceptsHtml(request.accept)
        ? { kind: 'login-redirect', location: loginUrl(deps.session, originalUrl(scheme, host, request.uri), scheme) }
        : { kind: 'unauthenticated', message };
    const target = await deps.hosts.resolveHost(host);
    if (!target) return { kind: 'forbidden', message: `未知的用户域主机 ${host}` };
    if (!request.sessionToken) return challenge('未登录');
    const resolved = await resolveSessionDetail(request.sessionToken);
    if (!resolved) return challenge('会话无效或已过期，请重新登录');
    const { user, authMethod } = resolved;
    if (target.kind === 'service-user') {
      const gate = await serviceHostGate(deps, user, target);
      if (gate) return gate;
    }
    const audience = target.kind === 'console' ? CONSOLE_AUDIENCE : serviceAudience(target.identity);
    if (target.kind === 'console') {
      // 工作台是平台自己的面：身份字段不受转发集约束，另外带上本次会话的认证方式。
      // 它是平台内部头（PLATFORM_INTERNAL_HEADERS），只在这一个分支注入，业务服务永远收不到。
      const identityToken = await deps.tokens.sign({
        subject: userSubject(user.id), audience, expiresInSeconds: IDENTITY_TOKEN_TTL_SECONDS,
        claims: { [TOKEN_CLAIMS.kind]: 'user', name: user.name, email: user.email },
      });
      return {
        kind: 'allow', user, audience, authMethod,
        injected: {
          ...base(user, identityToken),
          attributes: headerSafeAll({
            [IDENTITY_HEADERS.userName]: user.name,
            [IDENTITY_HEADERS.userEmail]: user.email,
            [PLATFORM_INTERNAL_HEADERS.authMethod]: authMethod,
          }),
        },
      };
    }
    const forwarding = await effectiveForwardingForSlug(target.projectSlug);
    const fields = forwarding?.fields ?? [];
    const profile = await identityProfile(deps, user, fields);
    const identityToken = await deps.tokens.sign({
      subject: userSubject(user.id), audience, expiresInSeconds: IDENTITY_TOKEN_TTL_SECONDS,
      claims: {
        [TOKEN_CLAIMS.kind]: 'user',
        [TOKEN_CLAIMS.project]: target.projectSlug,
        [TOKEN_CLAIMS.slot]: target.slot,
        ...forwardedTokenClaims(fields, profile),
      },
    });
    return {
      kind: 'allow', user, audience, authMethod,
      injected: { ...base(user, identityToken), attributes: headerSafeAll(forwardedHeaders(fields, profile)) },
    };
  };
}

/**
 * 业务主机放行前的关口：待命版与开发预览要项目成员或 preview 测试者（「用户」角色不算）；正式地址按应用可见范围放行
 * （2026-09-24 裁定），拦下时给平台统一的「没有项目权限」页；正式与待命版维护中只放行成员、管理员与临时指定的人（RFC-021）。
 * 待命槽上没有版本不在这里判：槽「已结束」时路由改指说明页（RFC-025 D13）。
 */
async function serviceHostGate(deps: Deps, user: UserDto, target: Extract<ResolvedHost, { kind: 'service-user' }>): Promise<UserAuthDecision | undefined> {
  if (target.slot !== 'prod' && !(await deps.previewAccess.canView(user.id, target.projectSlug, target.slot))) {
    return { kind: 'forbidden', message: `没有项目 ${target.projectSlug} 的 ${target.slot} 访问权限：需要项目成员或 preview 测试者` };
  }
  if (target.slot === 'prod') {
    const access = await deps.appAccess.check({ id: user.id, isAdmin: user.isAdmin }, target.projectSlug);
    if (access.kind === 'unknown') return { kind: 'forbidden', message: `未知的应用 ${target.projectSlug}` };
    if (access.kind === 'denied') {
      return { kind: 'no-app-access', denial: { projectId: access.projectId, appName: access.appName, ownerName: access.ownerName, requestable: access.requestable } };
    }
  }
  if (target.slot === 'dev') return undefined;
  const entry = await deps.serviceEntry.check(user.id, target.projectSlug, target.slot);
  return entry.kind === 'open' ? undefined : { kind: 'unavailable', entry };
}

function base(user: UserDto, identityToken: string): { userId: string; identityToken: string } {
  return { userId: user.id, identityToken };
}

function headerSafeAll(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, headerSafe(value)]));
}

/**
 * 自定义字段只存在于身份档案里，Git 名只在用户行上，所以只有生效集真的用到它们时才去查这两下。
 * 默认集合（显示名＋邮箱）下这条路一次库都不多查——它在每个业务请求的热路径上。
 */
async function identityProfile(deps: Deps, user: UserDto, fields: readonly string[]): Promise<IdentityProfile> {
  const needsAttrs = fields.some((key) => !FIXED_FIELDS.has(key));
  const needsGitName = fields.includes('git-name');
  const row = needsGitName ? await deps.users.getById(user.id) : undefined;
  const attrs = needsAttrs ? (await deps.uow.read.identities.listByUser(user.id))[0]?.profile ?? {} : {};
  return { name: user.name, email: user.email, gitName: row?.gitName ?? null, attrs };
}
