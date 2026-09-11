import type { AuthStatusDto } from '@crewstation/contracts';
import { PLATFORM_PATHS } from '@crewstation/contracts';
import { LOGIN_PATH, LOGOUT_PATH } from '../domain/session';
import type { IdentityUseCaseDeps } from './dependencies';
import { requireProvider } from './providerRequired';

/** 工作台据此渲染登录入口并标注演示身份。 */
export function authStatusUseCase({ provider }: Pick<IdentityUseCaseDeps, 'provider'>) {
  return (): AuthStatusDto => ({
    provider: requireProvider(provider).kind,
    loginPath: LOGIN_PATH,
    logoutPath: LOGOUT_PATH,
    jwksPath: PLATFORM_PATHS.jwks,
  });
}
