import type { LoginContext, LoginInput, LoginPage, LoginResult } from '../api/moduleApi';
import { resolveReturnTo } from '../domain/session';
import type { IdentityUseCaseDeps } from './dependencies';
import { ensureUserUseCase } from './ensureUser';
import { requireProvider } from './providerRequired';
import { sessionTokenUseCases } from './sessionTokens';

type Deps = Pick<IdentityUseCaseDeps, 'provider' | 'users' | 'settings' | 'session' | 'clock' | 'tokens'>;

/**
 * 登录用例。首版适配器是演示身份：GET 渲染带“演示身份”提示的表单，POST 以 `demo:<username>` 建档、签会话、跳回校验过的 returnTo。
 * OIDC 适配器接入时走同一条路径，只是 loginPage 变成跳转、handleLogin 变成回调处理。
 */
export function demoLoginUseCases(deps: Deps) {
  const ensureUser = ensureUserUseCase(deps);
  const { issueSession } = sessionTokenUseCases(deps);
  return {
    loginPage: async (returnTo: string | undefined, context: LoginContext = {}): Promise<LoginPage> =>
      requireProvider(deps.provider).loginPage({ returnTo: resolveReturnTo(returnTo, deps.session, context.scheme) }),
    login: async (input: LoginInput, context: LoginContext = {}): Promise<LoginResult> => {
      const outcome = await requireProvider(deps.provider).handleLogin(input);
      const user = await ensureUser(outcome.principal);
      const session = await issueSession(user);
      return { user, session, returnTo: resolveReturnTo(outcome.returnTo, deps.session, context.scheme) };
    },
  };
}
