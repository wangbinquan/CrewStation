import type { AuthMethod, UserDto } from '@crewstation/contracts';
import { AuthMethodSchema } from '@crewstation/contracts';
import type { IssuedSession } from '../api/moduleApi';
import { SESSION_AUDIENCE, SESSION_AUTH_CLAIM, userIdFromSubject, userSubject } from '../domain/session';
import type { IdentityUseCaseDeps } from './dependencies';
import { toDto } from './ensureUser';

type Deps = Pick<IdentityUseCaseDeps, 'tokens' | 'users' | 'session' | 'clock'>;

export interface ResolvedSession {
  readonly user: UserDto;
  readonly authMethod: AuthMethod;
}

/** 浏览器会话是一枚 aud=session 的平台 JWT，放在 cs_session Cookie 里；只有 cs-auth 验它。 */
export function sessionTokenUseCases({ tokens, users, session, clock }: Deps) {
  const resolveDetail = async (token: string): Promise<ResolvedSession | undefined> => {
    const verified = await tokens.verify(token, { audience: SESSION_AUDIENCE });
    const userId = verified ? userIdFromSubject(verified.subject) : undefined;
    if (!userId || !verified) return undefined;
    const user = await users.getById(userId);
    if (!user) return undefined;
    // 老会话没有这条声明时按常规登录处理：它只会让人「关不掉密码登录」，不会放宽任何东西。
    const parsed = AuthMethodSchema.safeParse(verified.claims[SESSION_AUTH_CLAIM]);
    return { user: toDto(user), authMethod: parsed.success ? parsed.data : 'password' };
  };
  return {
    issueSession: async (user: UserDto, authMethod: AuthMethod): Promise<IssuedSession> => {
      const token = await tokens.sign({
        subject: userSubject(user.id),
        audience: SESSION_AUDIENCE,
        expiresInSeconds: session.sessionTtlSeconds,
        claims: { cs_kind: 'session', [SESSION_AUTH_CLAIM]: authMethod },
      });
      return { token, expiresAt: new Date(clock.now().getTime() + session.sessionTtlSeconds * 1000) };
    },
    /** 无效、过期或用户已不存在都返回 undefined；调用方决定是跳转登录还是 401。 */
    resolveSession: async (token: string): Promise<UserDto | undefined> => (await resolveDetail(token))?.user,
    resolveSessionDetail: resolveDetail,
  };
}
