import type { LoginContext } from '../api/moduleApi';
import { loginUrl, resolveReturnTo } from '../domain/session';
import type { IdentityUseCaseDeps } from './dependencies';

/** 登出只是清 Cookie（会话 JWT 无服务端状态），然后回到登录页并保留校验过的 returnTo，便于演示时切换身份。 */
export function logoutUseCase({ session }: Pick<IdentityUseCaseDeps, 'session'>) {
  return (returnTo: string | undefined, context: LoginContext = {}): string =>
    loginUrl(session, resolveReturnTo(returnTo, session, context.scheme), context.scheme);
}
