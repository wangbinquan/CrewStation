import type { UserDto } from '@crewstation/contracts';
import type { IssuedSession } from '../api/moduleApi';
import { SESSION_AUDIENCE, userIdFromSubject, userSubject } from '../domain/session';
import type { IdentityUseCaseDeps } from './dependencies';
import { toDto } from './ensureUser';

type Deps = Pick<IdentityUseCaseDeps, 'tokens' | 'users' | 'session' | 'clock'>;

/** 浏览器会话是一枚 aud=session 的平台 JWT，放在 cs_session Cookie 里；只有 cs-auth 验它。 */
export function sessionTokenUseCases({ tokens, users, session, clock }: Deps) {
  return {
    issueSession: async (user: UserDto): Promise<IssuedSession> => {
      const token = await tokens.sign({
        subject: userSubject(user.id),
        audience: SESSION_AUDIENCE,
        expiresInSeconds: session.sessionTtlSeconds,
        claims: { cs_kind: 'session' },
      });
      return { token, expiresAt: new Date(clock.now().getTime() + session.sessionTtlSeconds * 1000) };
    },
    /** 无效、过期或用户已不存在都返回 undefined；调用方决定是跳转登录还是 401。 */
    resolveSession: async (token: string): Promise<UserDto | undefined> => {
      const verified = await tokens.verify(token, { audience: SESSION_AUDIENCE });
      const userId = verified ? userIdFromSubject(verified.subject) : undefined;
      if (!userId) return undefined;
      const user = await users.getById(userId);
      return user ? toDto(user) : undefined;
    },
  };
}
