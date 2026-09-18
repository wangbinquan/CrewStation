import { PasswordLoginRequestSchema } from '@crewstation/contracts';
import { PlatformError, unauthenticated, validation } from '@crewstation/kernel';
import type { LoginContext, LoginInput, LoginResult } from '../api/moduleApi';
import { bootstrapTokenUsable, passwordLoginUsable } from '../domain/loginMethods';
import { resolveReturnTo } from '../domain/session';
import type { IdentityUseCaseDeps } from './dependencies';
import { toDto } from './ensureUser';
import { sessionTokenUseCases } from './sessionTokens';

type Deps = Pick<IdentityUseCaseDeps, 'users' | 'uow' | 'passwords' | 'settings' | 'session' | 'clock' | 'tokens'>;

/**
 * 常规登录（本地用户名＋密码）。只有引导管理员这一条本地账户来源，
 * 因此这里的每条拒绝分支都要走同样的耗时，否则响应时间会告诉攻击者账号存不存在。
 */
export function passwordLoginUseCases(deps: Deps) {
  const { issueSession } = sessionTokenUseCases(deps);
  return {
    passwordLogin: async (input: LoginInput, context: LoginContext = {}): Promise<LoginResult> => {
      const parsed = PasswordLoginRequestSchema.safeParse(withoutBlankFields(input));
      if (!parsed.success) throw validation('请输入用户名与密码');
      const { username, password, returnTo } = parsed.data;
      const policy = await deps.uow.read.policy.read();
      if (bootstrapTokenUsable(policy)) {
        await deps.passwords.verifyDummy(password);
        throw new PlatformError('forbidden', '请先用引导令牌创建首位管理员', { code: 'bootstrap-admin-required' });
      }
      if (!passwordLoginUsable(policy, deps.settings.passwordLoginForcedOn === true)) {
        await deps.passwords.verifyDummy(password);
        throw new PlatformError('forbidden', '用户名密码登录已被管理员关闭，请使用公司身份登录', { code: 'password-login-disabled' });
      }
      const user = await deps.users.getByUsername(username.toLowerCase());
      if (!user?.passwordHash) {
        await deps.passwords.verifyDummy(password);
        throw unauthenticated('用户名或密码不正确');
      }
      if (!(await deps.passwords.verify(password, user.passwordHash))) throw unauthenticated('用户名或密码不正确');
      const now = deps.clock.now();
      await deps.users.update({ ...user, lastLoginAt: now });
      const dto = toDto(user);
      return { user: dto, session: await issueSession(dto, 'password'), returnTo: resolveReturnTo(returnTo, deps.session, context.scheme) };
    },
  };
}

/** 浏览器表单把未填的可选字段提交为空串；按缺省处理。 */
function withoutBlankFields(input: LoginInput): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => !(typeof value === 'string' && value.trim() === '')));
}
