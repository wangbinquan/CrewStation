import type { LoginDiscoveryDto } from '@crewstation/contracts';
import { loginDiscovery } from '../domain/loginMethods';
import type { IdentityUseCaseDeps } from './dependencies';

type Deps = Pick<IdentityUseCaseDeps, 'uow' | 'settings'>;

/** 登录页与 `/auth/status` 的唯一数据源：引导未完成时只有引导令牌一条路。 */
export function loginDiscoveryUseCases(deps: Deps) {
  return {
    loginMethods: async (): Promise<LoginDiscoveryDto> => {
      const policy = await deps.uow.read.policy.read();
      const providers = policy.bootstrapCompletedAt === null ? [] : await deps.uow.read.providers.listEnabled();
      return loginDiscovery(policy, providers, deps.settings.passwordLoginForcedOn === true);
    },
  };
}
