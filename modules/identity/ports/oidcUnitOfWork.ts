import type { IdentityForwardingRepository, LoginPolicyRepository, OidcFlowRepository, OidcProviderRepository, UserIdentityRepository } from './oidcRepositories';
import type { UserRepository } from './userRepository';

/** 一次事务里能用到的全部仓储；引导与「关闭常规登录」这类判定必须与写在同一事务内。 */
export interface OidcRepositoryScope {
  readonly users: UserRepository;
  readonly providers: OidcProviderRepository;
  readonly identities: UserIdentityRepository;
  readonly flows: OidcFlowRepository;
  readonly policy: LoginPolicyRepository;
  readonly forwarding: IdentityForwardingRepository;
}

export interface OidcUnitOfWork {
  readonly read: OidcRepositoryScope;
  run<T>(fn: (scope: OidcRepositoryScope) => Promise<T>): Promise<T>;
}
