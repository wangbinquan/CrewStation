import type { Database, Executor } from '@crewstation/persistence';
import type { OidcRepositoryScope, OidcUnitOfWork } from '../../ports/oidcUnitOfWork';
import { drizzleIdentityForwardingRepository, drizzleLoginPolicyRepository, drizzleOidcFlowRepository, drizzleOidcProviderRepository, drizzleUserIdentityRepository } from './drizzleOidcRepositories';
import { drizzleUserRepository } from './drizzleUserRepository';

export function oidcScopeOver(executor: Executor): OidcRepositoryScope {
  return {
    users: drizzleUserRepository(executor),
    providers: drizzleOidcProviderRepository(executor),
    identities: drizzleUserIdentityRepository(executor),
    flows: drizzleOidcFlowRepository(executor),
    policy: drizzleLoginPolicyRepository(executor),
    forwarding: drizzleIdentityForwardingRepository(executor),
  };
}

export function drizzleOidcUnitOfWork(db: Database): OidcUnitOfWork {
  return { read: oidcScopeOver(db), run: (fn) => db.transaction((tx) => fn(oidcScopeOver(tx))) };
}
