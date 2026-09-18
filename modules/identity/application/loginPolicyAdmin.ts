import type { AuthMethod, LoginPolicyDto } from '@crewstation/contracts';
import { PlatformError, conflict, forbidden } from '@crewstation/kernel';
import { canDisablePasswordLogin } from '../domain/loginMethods';
import type { IdentityUseCaseDeps } from './dependencies';

type Deps = Pick<IdentityUseCaseDeps, 'uow' | 'settings' | 'clock'>;

/** 调用者：管理面路由从网关注入的身份加 ForwardAuth 注入的认证方式得到。 */
export interface PolicyActor {
  readonly isAdmin: boolean;
  readonly authMethod: AuthMethod;
}

/** 关闭常规登录的三条前置见 domain/loginMethods；这里只做「查出前置所需的事实 → 裁定 → 写」。 */
export function loginPolicyUseCases(deps: Deps) {
  const forcedOn = (): boolean => deps.settings.passwordLoginForcedOn === true;
  const snapshot = async (actor: PolicyActor): Promise<LoginPolicyDto> => {
    const [policy, enabledProviderCount] = await Promise.all([deps.uow.read.policy.read(), deps.uow.read.providers.countEnabled()]);
    return {
      passwordLoginEnabled: policy.passwordLoginEnabled,
      bootstrapCompletedAt: policy.bootstrapCompletedAt?.toISOString() ?? null,
      forcedOn: forcedOn(),
      enabledProviderCount,
      callerAuthMethod: actor.authMethod,
    };
  };
  return {
    readLoginPolicy: async (actor: PolicyActor): Promise<LoginPolicyDto> => {
      if (!actor.isAdmin) throw forbidden('只有管理员可以查看登录策略');
      return snapshot(actor);
    },
    setPasswordLoginEnabled: async (actor: PolicyActor, enabled: boolean): Promise<LoginPolicyDto> => {
      if (!actor.isAdmin) throw forbidden('只有管理员可以修改登录策略');
      const now = deps.clock.now();
      if (enabled) {
        if (forcedOn()) throw conflict('安装配置已强制开启用户名密码登录，库内策略暂不生效', { code: 'password-login-forced-on' });
        await deps.uow.run((scope) => scope.policy.setPasswordLoginEnabled(true, now));
        return snapshot(actor);
      }
      // 判定与写在同一事务里：并发地停用最后一个 Provider 与关闭密码登录不能同时得逞。
      await deps.uow.run(async (scope) => {
        const verdict = canDisablePasswordLogin({
          isAdmin: actor.isAdmin,
          authMethod: actor.authMethod,
          enabledProviderCount: await scope.providers.countEnabled(),
          forcedOn: forcedOn(),
        });
        if (!verdict.allowed) throw refusal(verdict.reason);
        await scope.policy.setPasswordLoginEnabled(false, now);
      });
      return snapshot(actor);
    },
  };
}

function refusal(reason: 'not-admin' | 'requires-oidc-session' | 'requires-enabled-oidc' | 'forced-on'): PlatformError {
  switch (reason) {
    case 'not-admin':
      return forbidden('只有管理员可以修改登录策略');
    case 'requires-oidc-session':
      return new PlatformError('forbidden', '请先用公司身份登录，再关闭用户名密码登录：只有已经证明能经 OIDC 进来的管理员才能关掉它', { code: 'password-login-requires-oidc-session' });
    case 'requires-enabled-oidc':
      return conflict('至少要有一个启用的身份提供方，才能关闭用户名密码登录', { code: 'password-login-requires-enabled-oidc' });
    case 'forced-on':
      return conflict('安装配置已强制开启用户名密码登录，请先去掉 CS_PASSWORD_LOGIN=force-on 并重启 cs-auth', { code: 'password-login-forced-on' });
  }
}
