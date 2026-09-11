import { join } from 'node:path';
import { TOKEN_CLAIMS } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { keyRingTokenService } from './adapters/jwt/keyRingTokenService';
import { drizzleKeyStore } from './adapters/persistence/drizzleKeyStore';
import { drizzleUserRepository } from './adapters/persistence/drizzleUserRepository';
import type { IdentityModuleApi } from './api/moduleApi';
import { authStatusUseCase } from './application/authStatus';
import { currentUserUseCase } from './application/currentUser';
import { demoLoginUseCases } from './application/demoLogin';
import type { IdentityUseCaseDeps } from './application/dependencies';
import { ensureUserUseCase } from './application/ensureUser';
import { forwardAuthServiceUseCase } from './application/forwardAuthService';
import { forwardAuthUserUseCase } from './application/forwardAuthUser';
import { logoutUseCase } from './application/logout';
import { queryUsersUseCases } from './application/queryUsers';
import { sessionTokenUseCases } from './application/sessionTokens';
import { resolveHostByPattern } from './domain/hosts';
import type { SessionSettings } from './domain/session';
import { sessionCookie, withSessionDefaults } from './domain/session';
import { authRoutes } from './http/authRoutes';
import { forwardAuthRoutes } from './http/forwardAuthRoutes';
import { userRoutes } from './http/userRoutes';
import type { AllowlistEvaluator } from './ports/allowlistEvaluator';
import type { HostResolver } from './ports/hostResolver';
import type { IdentityProvider } from './ports/identityProvider';
import type { IdentitySettings } from './ports/identitySettings';
import type { KeyStore } from './ports/keyStore';
import type { MembershipLookup } from './ports/membershipLookup';
import type { PreviewAccess } from './ports/previewAccess';
import type { WorkloadLookup } from './ports/workloadLookup';

// 应用装配需要的端口类型与内置适配器只能经根入口取得，故在此转出。
export { demoIdentityProvider } from './adapters/provider/demoIdentityProvider';
export type { AllowlistEvaluator, AllowlistTarget, AllowlistVerdict } from './ports/allowlistEvaluator';
export type { HostResolver } from './ports/hostResolver';
export type { IdentityProvider, LoginPrincipal, ProviderLoginOutcome, ProviderLoginPage } from './ports/identityProvider';
export type { IdentitySettings } from './ports/identitySettings';
export type { KeyStore } from './ports/keyStore';
export type { MembershipLookup } from './ports/membershipLookup';
export type { PreviewAccess } from './ports/previewAccess';
export type { WorkloadLookup } from './ports/workloadLookup';
export type { ResolvedHost, UserSlot } from './domain/hosts';

/** 运行面（cs-auth）的外部能力；缺省实现一律“拒绝／未知”，不配置也安全。 */
export interface IdentityRuntimeDeps {
  provider?: IdentityProvider;
  /** 缺省存到本模块的 identity.signing_keys 表。 */
  keyStore?: KeyStore;
  /** 缺省按 contracts HOST_PATTERNS 与 settings.userDomain 推导。 */
  hostResolver?: HostResolver;
  previewAccess?: PreviewAccess;
  workloadLookup?: WorkloadLookup;
  allowlistEvaluator?: AllowlistEvaluator;
  membershipLookup?: MembershipLookup;
  logger?: Logger;
}

export interface IdentityModuleDeps extends IdentityRuntimeDeps {
  db: Database;
  settings: IdentitySettings;
  clock?: Clock;
}

/** cs-auth 挂 auth 与 forwardAuth，cs-api 挂 users。 */
export interface IdentityModuleHttp {
  readonly auth: Hono<AppEnv>[];
  readonly forwardAuth: Hono<AppEnv>[];
  readonly users: Hono<AppEnv>[];
}

export interface IdentityModule {
  readonly api: IdentityModuleApi;
  readonly http: IdentityModuleHttp;
  readonly migrations: MigrationSet;
}

export const identityMigrations: MigrationSet = {
  module: 'identity',
  layer: 1,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createIdentityModule(deps: IdentityModuleDeps): IdentityModule {
  const clock = deps.clock ?? systemClock;
  const session = withSessionDefaults(deps.settings);
  const useCaseDeps: IdentityUseCaseDeps = {
    users: drizzleUserRepository(deps.db),
    settings: deps.settings,
    session,
    clock,
    tokens: keyRingTokenService({ keyStore: deps.keyStore ?? drizzleKeyStore(deps.db), issuer: TOKEN_CLAIMS.issuer, clock, logger: deps.logger }),
    provider: deps.provider,
    ...runtimePorts(deps, session),
  };
  const api: IdentityModuleApi = {
    name: 'identity',
    ensureUser: ensureUserUseCase(useCaseDeps),
    ...queryUsersUseCases(useCaseDeps.users),
    providerKind: deps.provider?.kind,
    sessionCookie: sessionCookie(session),
    authStatus: authStatusUseCase(useCaseDeps),
    ...demoLoginUseCases(useCaseDeps),
    logoutRedirect: logoutUseCase(useCaseDeps),
    resolveSession: sessionTokenUseCases(useCaseDeps).resolveSession,
    authorizeUserRequest: forwardAuthUserUseCase(useCaseDeps),
    authorizeServiceRequest: forwardAuthServiceUseCase(useCaseDeps),
    currentUser: currentUserUseCase(useCaseDeps),
    jwks: () => useCaseDeps.tokens.jwks(),
    rotateSigningKey: () => useCaseDeps.tokens.rotate(),
  };
  return {
    api,
    http: { auth: [authRoutes(api)], forwardAuth: [forwardAuthRoutes(api)], users: [userRoutes(api)] },
    migrations: identityMigrations,
  };
}

function runtimePorts(deps: IdentityRuntimeDeps, session: SessionSettings): Pick<IdentityUseCaseDeps, 'hosts' | 'previewAccess' | 'workloads' | 'allowlist' | 'memberships'> {
  return {
    hosts: deps.hostResolver ?? { resolveHost: async (host) => resolveHostByPattern(host, session.userDomain) },
    previewAccess: deps.previewAccess ?? { canView: async () => false },
    workloads: deps.workloadLookup ?? { byIp: async () => undefined },
    allowlist: deps.allowlistEvaluator ?? { evaluate: async (_caller, target) => ({ allowed: false, reason: '未配置放行表评估器', targetIdentity: target.host }) },
    memberships: deps.membershipLookup ?? { membershipsOf: async () => [] },
  };
}
