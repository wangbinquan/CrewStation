import type { LegacyIdentityLookup } from './ports/legacyIdentity';
import { join } from 'node:path';
import { TOKEN_CLAIMS } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { keyedLock, readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { keyRingTokenService } from './adapters/jwt/keyRingTokenService';
import { secretBoxCipher } from './adapters/crypto/secretBoxCipher';
import { cachedEndpointResolver } from './adapters/idp/cachedEndpointResolver';
import { httpIdpClient } from './adapters/idp/httpIdpClient';
import { bunPasswordHasher } from './adapters/password/bunPasswordHasher';
import { drizzleKeyStore } from './adapters/persistence/drizzleKeyStore';
import { drizzleOidcUnitOfWork } from './adapters/persistence/drizzleOidcUnitOfWork';
import { drizzleUserRepository } from './adapters/persistence/drizzleUserRepository';
import type { IdentityModuleApi } from './api/moduleApi';
import { bootstrapAdminUseCases } from './application/bootstrapAdmin';
import { renderBootstrapPage } from './application/bootstrapPage';
import { currentUserUseCase } from './application/currentUser';
import { renderForbiddenPage } from './application/forbiddenPage';
import type { IdentityUseCaseDeps } from './application/dependencies';
import { devSessionTokenUseCases } from './application/devSessionTokens';
import { ensureUserUseCase } from './application/ensureUser';
import { forwardAuthServiceUseCase } from './application/forwardAuthService';
import { forwardAuthUserUseCase } from './application/forwardAuthUser';
import { loginDiscoveryUseCases } from './application/loginDiscovery';
import { renderLoginErrorPage, renderLoginPage } from './application/loginPages';
import { loginPolicyUseCases } from './application/loginPolicyAdmin';
import { logoutUseCase } from './application/logout';
import { forwardingUseCases } from './application/oidc/forwardingAdmin';
import { oidcLoginUseCases } from './application/oidc/login';
import { providerAdminUseCases } from './application/oidc/providerAdmin';
import { passwordLoginUseCases } from './application/passwordLogin';
import { queryUsersUseCases } from './application/queryUsers';
import { platformRoleUseCases } from './application/roles/platformRoles';
import { sessionTokenUseCases } from './application/sessionTokens';
import { resolveHostByPattern } from './domain/hosts';
import { resolveReturnTo } from './domain/session';
import type { SessionSettings } from './domain/session';
import { consoleOrigin, sessionCookie, withSessionDefaults } from './domain/session';
import { adminAuthRoutes } from './http/adminAuthRoutes';
import { authRoutes } from './http/authRoutes';
import { devSessionGate } from './http/devSessionGate';
import { forwardAuthRoutes } from './http/forwardAuthRoutes';
import { userRoutes } from './http/userRoutes';
import type { AllowlistEvaluator } from './ports/allowlistEvaluator';
import type { DevSessionState } from './ports/devSessionState';
import type { HostResolver } from './ports/hostResolver';
import type { IdentitySettings } from './ports/identitySettings';
import type { KeyStore } from './ports/keyStore';
import type { MembershipLookup } from './ports/membershipLookup';
import type { EndpointResolver, IdpClient } from './ports/idpClient';
import type { OidcUnitOfWork } from './ports/oidcUnitOfWork';
import type { PasswordHasher } from './ports/passwordHasher';
import type { SecretCipher } from './ports/secretCipher';
import type { PreviewAccess } from './ports/previewAccess';
import type { ProjectDirectory } from './ports/projectDirectory';
import type { WorkloadLookup } from './ports/workloadLookup';

// 应用装配需要的端口类型与内置适配器只能经根入口取得，故在此转出。
export type { AllowlistEvaluator, AllowlistTarget, AllowlistVerdict } from './ports/allowlistEvaluator';
export type { DevSessionState } from './ports/devSessionState';
export type { HostResolver } from './ports/hostResolver';
export type { IdentitySettings } from './ports/identitySettings';
export type { KeyStore } from './ports/keyStore';
export type { MembershipLookup } from './ports/membershipLookup';
export type { EndpointResolver, ExchangeCodeInput, FetchUserinfoInput, IdpClient, TokenResponse } from './ports/idpClient';
export type { OidcProviderRecord, OidcProviderRepository, UserIdentityRecord } from './ports/oidcRepositories';
export type { OidcRepositoryScope, OidcUnitOfWork } from './ports/oidcUnitOfWork';
export type { PasswordHasher } from './ports/passwordHasher';
export type { SecretCipher } from './ports/secretCipher';
export type { PreviewAccess } from './ports/previewAccess';
export type { ProjectDirectory } from './ports/projectDirectory';
export type { WorkloadLookup } from './ports/workloadLookup';
export type { ResolvedHost, UserSlot } from './domain/hosts';

/** 运行面（cs-auth）的外部能力；缺省实现一律“拒绝／未知”，不配置也安全。 */
export interface IdentityRuntimeDeps {
  legacyIds?: LegacyIdentityLookup;
  /** 缺省存到本模块的 identity.signing_keys 表。 */
  keyStore?: KeyStore;
  /** 缺省按 contracts HOST_PATTERNS 与 settings.userDomain 推导。 */
  hostResolver?: HostResolver;
  previewAccess?: PreviewAccess;
  /** 项目 slug → ID，供身份转发按项目取覆盖；缺省一律按全局默认。 */
  projectDirectory?: ProjectDirectory;
  workloadLookup?: WorkloadLookup;
  allowlistEvaluator?: AllowlistEvaluator;
  membershipLookup?: MembershipLookup;
  /** 缺省“查不到任何会话”，即所有开发会话令牌都被拒绝；装配后由 task-runtime 现查。 */
  devSessionState?: DevSessionState;
  logger?: Logger;
}

export interface IdentityModuleDeps extends IdentityRuntimeDeps {
  db: Database;
  /** 测试可注入假仓储；生产用 identity schema 自己的表。 */
  unitOfWork?: OidcUnitOfWork;
  passwords?: PasswordHasher;
  /** 测试注入假 IdP／解析器／封存；生产是 HTTP＋进程内缓存＋secretbox。 */
  idp?: IdpClient;
  endpointResolver?: EndpointResolver;
  secretCipher?: SecretCipher;
  settings: IdentitySettings;
  clock?: Clock;
}

/** cs-auth 挂 auth 与 forwardAuth；cs-api 挂 users，并把 devSessionGate 排在路由表最前。 */
export interface IdentityModuleHttp {
  readonly auth: Hono<AppEnv>[];
  readonly forwardAuth: Hono<AppEnv>[];
  readonly users: Hono<AppEnv>[];
  readonly devSessionGate: Hono<AppEnv>[];
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
  const idp = deps.idp ?? httpIdpClient({ ...(deps.logger ? { logger: deps.logger } : {}) });
  const useCaseDeps: IdentityUseCaseDeps = {
    users: drizzleUserRepository(deps.db),
    legacyIds: deps.legacyIds,
    settings: deps.settings,
    session,
    clock,
    uow: deps.unitOfWork ?? drizzleOidcUnitOfWork(deps.db),
    passwords: deps.passwords ?? bunPasswordHasher(),
    idp,
    endpoints: deps.endpointResolver ?? cachedEndpointResolver(idp, clock),
    secrets: deps.secretCipher ?? secretBoxCipher(deps.settings.secretKey),
    tokens: keyRingTokenService({ keyStore: deps.keyStore ?? drizzleKeyStore(deps.db), issuer: TOKEN_CLAIMS.issuer, clock, logger: deps.logger }),
    ...runtimePorts(deps, session),
  };
  const discovery = loginDiscoveryUseCases(useCaseDeps);
  // 一个实例贯穿管理面与 ForwardAuth：注入路径的短缓存要能被本副本自己的写入立刻清掉。
  const forwarding = forwardingUseCases(useCaseDeps);
  const api: IdentityModuleApi = {
    name: 'identity',
    ensureUser: ensureUserUseCase(useCaseDeps),
    ...queryUsersUseCases(useCaseDeps.users),
    ...platformRoleUseCases({ ...useCaseDeps, roleLock: { run: (id, work) => keyedLock(deps.db)(['platform-roles', `user-role:${id}`], work) } }),
    sessionCookie: sessionCookie(session),
    ...discovery,
    loginPageHtml: async (returnTo, context = {}, error, justBootstrapped) =>
      renderLoginPage({
        discovery: await discovery.loginMethods(),
        returnTo: resolveReturnTo(returnTo, session, context.scheme),
        ...(error === undefined ? {} : { error }),
        ...(justBootstrapped === undefined ? {} : { justBootstrapped }),
      }),
    ...passwordLoginUseCases(useCaseDeps),
    bootstrapPageHtml: renderBootstrapPage,
    ...bootstrapAdminUseCases(useCaseDeps),
    ...oidcLoginUseCases(useCaseDeps),
    loginErrorPageHtml: (code) => renderLoginErrorPage(code),
    logoutRedirect: logoutUseCase(useCaseDeps),
    forbiddenPage: (message, context = {}) => renderForbiddenPage({ message, consoleUrl: `${consoleOrigin(session, context.scheme)}/` }),
    resolveSession: sessionTokenUseCases(useCaseDeps).resolveSession,
    authorizeUserRequest: forwardAuthUserUseCase(useCaseDeps, forwarding),
    authorizeServiceRequest: forwardAuthServiceUseCase(useCaseDeps),
    ...loginPolicyUseCases(useCaseDeps),
    ...providerAdminUseCases(useCaseDeps),
    ...forwarding,
    ...devSessionTokenUseCases(useCaseDeps),
    currentUser: currentUserUseCase(useCaseDeps),
    jwks: () => useCaseDeps.tokens.jwks(),
    rotateSigningKey: () => useCaseDeps.tokens.rotate(),
  };
  return {
    api,
    http: { auth: [authRoutes(api)], forwardAuth: [forwardAuthRoutes(api)], users: [userRoutes(api), adminAuthRoutes(api)], devSessionGate: [devSessionGate(api)] },
    migrations: identityMigrations,
  };
}

function runtimePorts(deps: IdentityRuntimeDeps, session: SessionSettings): Pick<IdentityUseCaseDeps, 'hosts' | 'previewAccess' | 'projects' | 'workloads' | 'allowlist' | 'memberships' | 'devSessions'> {
  return {
    hosts: deps.hostResolver ?? { resolveHost: async (host) => resolveHostByPattern(host, session.userDomain) },
    previewAccess: deps.previewAccess ?? { canView: async () => false },
    projects: deps.projectDirectory ?? { idBySlug: async () => undefined },
    workloads: deps.workloadLookup ?? { byIp: async () => undefined },
    allowlist: deps.allowlistEvaluator ?? { evaluate: async (_caller, target) => ({ allowed: false, reason: '未配置放行表评估器', targetIdentity: target.host }) },
    memberships: deps.membershipLookup ?? { membershipsOf: async () => [] },
    devSessions: deps.devSessionState ?? { activeSession: async () => undefined },
  };
}
