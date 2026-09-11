import type { UserDto } from '@crewstation/contracts';
import { TOKEN_CLAIMS } from '@crewstation/contracts';
import type { UserAuthDecision, UserAuthRequest } from '../api/moduleApi';
import { acceptsHtml, firstHost, headerSafe, originalUrl } from '../domain/forwardedRequest';
import type { ResolvedHost } from '../domain/hosts';
import { CONSOLE_AUDIENCE, IDENTITY_TOKEN_TTL_SECONDS, loginUrl, schemeOf, serviceAudience, userSubject } from '../domain/session';
import type { IdentityUseCaseDeps } from './dependencies';
import { sessionTokenUseCases } from './sessionTokens';

type Deps = Pick<IdentityUseCaseDeps, 'tokens' | 'users' | 'session' | 'clock' | 'hosts' | 'previewAccess'>;

/**
 * 用户域 ForwardAuth（Design §7.1）：Cookie 会话 → 用户 → 目标主机 → preview／dev 的访问权 → 绑定目标 aud 的身份令牌。
 * 未登录的浏览器导航跳转登录页并带原始地址；非浏览器请求回 401。
 */
export function forwardAuthUserUseCase(deps: Deps) {
  const { resolveSession } = sessionTokenUseCases(deps);
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
    const user = await resolveSession(request.sessionToken);
    if (!user) return challenge('会话无效或已过期，请重新登录');
    if (target.kind === 'service-user' && target.slot !== 'prod' && !(await deps.previewAccess.canView(user.id, target.projectSlug, target.slot))) {
      return { kind: 'forbidden', message: `没有项目 ${target.projectSlug} 的 ${target.slot} 访问权限：需要项目成员或 preview 测试者` };
    }
    const audience = target.kind === 'console' ? CONSOLE_AUDIENCE : serviceAudience(target.identity);
    const identityToken = await deps.tokens.sign({
      subject: userSubject(user.id),
      audience,
      expiresInSeconds: IDENTITY_TOKEN_TTL_SECONDS,
      claims: identityClaims(user, target),
    });
    return {
      kind: 'allow',
      user,
      audience,
      injected: { userId: user.id, userName: headerSafe(user.name), userEmail: headerSafe(user.email), identityToken },
    };
  };
}

function identityClaims(user: UserDto, target: ResolvedHost): Record<string, string> {
  const base = { [TOKEN_CLAIMS.kind]: 'user', name: user.name, email: user.email };
  return target.kind === 'console' ? base : { ...base, [TOKEN_CLAIMS.project]: target.projectSlug, [TOKEN_CLAIMS.slot]: target.slot };
}
