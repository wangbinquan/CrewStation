import type { OidcLoginFailureCode, UserDto, UserId } from '@crewstation/contracts';
import { PlatformError, newId, notFound } from '@crewstation/kernel';
import type { IssuedSession, LoginContext } from '../../api/moduleApi';
import { applyEmailTrust, isOidcLoginError, resolveProfileNames } from '../../domain/idpClaims';
import type { IdpClaims } from '../../domain/idpClaims';
import { bootstrapTokenUsable } from '../../domain/loginMethods';
import { OIDC_FLOW_TTL_SECONDS, buildAuthorizeUrl, newOidcFlowSeed, oidcRedirectUri } from '../../domain/oidcFlow';
import { decideProvisioning } from '../../domain/provisioning';
import { consoleOrigin, resolveReturnTo } from '../../domain/session';
import type { User } from '../../domain/user';
import { oidcExternalId, shouldBootstrapAdmin, usernameCandidates } from '../../domain/user';
import type { OidcProviderRecord } from '../../ports/oidcRepositories';
import type { IdentityUseCaseDeps } from '../dependencies';
import { toDto } from '../ensureUser';
import { sessionTokenUseCases } from '../sessionTokens';
import { acquireIdentityClaims } from './acquireClaims';

type Deps = Pick<IdentityUseCaseDeps, 'uow' | 'settings' | 'session' | 'clock' | 'tokens' | 'users' | 'idp' | 'endpoints' | 'secrets'>;

export type OidcCallbackOutcome =
  | { readonly kind: 'session'; readonly user: UserDto; readonly session: IssuedSession; readonly returnTo: string }
  | { readonly kind: 'failed'; readonly code: OidcLoginFailureCode };

/** 一次成功登录后要写进平台的档案；`attrs` 是自定义映射字段，转发与否另由转发集决定（A8）。 */
interface ResolvedProfile {
  readonly displayName: string;
  readonly gitName: string;
  readonly email: string | null;
  readonly attrs: Readonly<Record<string, string>>;
}

export function oidcLoginUseCases(deps: Deps) {
  return { ...startUseCase(deps), ...callbackUseCase(deps) };
}

function startUseCase(deps: Deps) {
  /** 跳转地址只按安装配置推导，不读请求 Host：start 与 callback 两侧必须逐字节一致。 */
  const origin = (): string => consoleOrigin(deps.session);
  return {
    startOidcLogin: async (slug: string, returnTo: string | undefined, context: LoginContext = {}): Promise<{ location: string }> => {
      const policy = await deps.uow.read.policy.read();
      if (bootstrapTokenUsable(policy)) throw new PlatformError('forbidden', '请先用引导令牌创建首位管理员', { code: 'bootstrap-admin-required' });
      const provider = await deps.uow.read.providers.findBySlug(slug);
      if (!provider || !provider.enabled) throw notFound('身份提供方', slug);
      const effective = await deps.endpoints.resolve(provider);
      if (effective.authorizationEndpoint === null) {
        throw new PlatformError('unavailable', '无法解析该身份提供方的授权端点：自动发现失败且没有可用的手工端点', { code: 'endpoints-unresolved' });
      }
      const seed = newOidcFlowSeed();
      const now = deps.clock.now();
      const redirectUri = oidcRedirectUri(origin(), provider.slug);
      await deps.uow.run(async (scope) => {
        // 过期行在发起时顺手清，不为它单开一个后台 worker。
        await scope.flows.sweepExpired(now, 200);
        await scope.flows.start({
          state: seed.state,
          providerId: provider.id,
          redirectUri,
          codeVerifier: seed.codeVerifier,
          nonce: seed.nonce,
          returnTo: resolveReturnTo(returnTo, deps.session, context.scheme),
          expiresAt: new Date(now.getTime() + OIDC_FLOW_TTL_SECONDS * 1000),
        }, now);
      });
      return {
        location: buildAuthorizeUrl(effective.authorizationEndpoint, {
          clientId: provider.clientId,
          scopes: provider.scopes,
          state: seed.state,
          codeChallenge: seed.codeChallenge,
          nonce: seed.nonce,
          redirectUri,
        }),
      };
    },

  };
}

function callbackUseCase(deps: Deps) {
  const { issueSession } = sessionTokenUseCases(deps);
  return {
    completeOidcLogin: async (query: { readonly code?: string; readonly state?: string }): Promise<OidcCallbackOutcome> => {
      const code = query.code;
      const state = query.state;
      if (!code || !state) return { kind: 'failed', code: 'invalid-callback' };
      if (bootstrapTokenUsable(await deps.uow.read.policy.read())) return { kind: 'failed', code: 'bootstrap-admin-required' };
      const now = deps.clock.now();
      // 一次性消费：同一个 state 回放第二次、或过期的 state，都在这里就止住。
      const flow = await deps.uow.run((scope) => scope.flows.consume(state, now));
      if (!flow) return { kind: 'failed', code: 'state-expired' };
      const provider = await deps.uow.read.providers.findById(flow.providerId);
      if (!provider || !provider.enabled) return { kind: 'failed', code: 'provider-disabled' };
      let clientSecret: string;
      try {
        const boxed = await deps.uow.read.providers.clientSecretEncOf(provider.id);
        if (!boxed) return { kind: 'failed', code: 'client-secret-missing' };
        clientSecret = await deps.secrets.open(boxed);
      } catch {
        return { kind: 'failed', code: 'client-secret-missing' };
      }
      const effective = await deps.endpoints.resolve(provider);
      if (effective.tokenEndpoint === null) return { kind: 'failed', code: 'endpoints-unresolved' };

      let claims: IdpClaims;
      let profile: ResolvedProfile;
      try {
        const tokens = await deps.idp.exchangeCode({
          tokenEndpoint: effective.tokenEndpoint,
          clientId: provider.clientId,
          clientSecret,
          code,
          codeVerifier: flow.codeVerifier,
          redirectUri: flow.redirectUri,
        });
        claims = applyEmailTrust(await acquireIdentityClaims(deps.idp, {
          tokens,
          effective,
          clientId: provider.clientId,
          scopes: provider.scopes,
          nonce: flow.nonce,
          userinfoRequestStyle: provider.userinfoRequestStyle,
          selectors: provider,
        }), provider.trustEmailVerified);
        const names = resolveProfileNames(provider, claims);
        profile = { displayName: names.displayName, gitName: names.gitName, email: claims.email, attrs: claims.attrs };
      } catch (error) {
        if (isOidcLoginError(error)) return { kind: 'failed', code: error.code };
        throw error;
      }

      const existing = await deps.uow.read.identities.findByProviderSubject(provider.id, claims.subject);
      const decision = decideProvisioning(provider, claims, existing?.userId ?? null);
      if (decision.action === 'reject') return { kind: 'failed', code: decision.reason };

      try {
        const user = decision.action === 'login'
          ? await refreshExisting(deps, provider, claims, profile, decision.userId as UserId, now)
          : await createWithIdentity(deps, provider, claims, profile, now);
          return { kind: 'session', user, session: await issueSession(user, 'oidc'), returnTo: flow.returnTo };
      } catch (error) {
        // 写入期的唯一键冲突意味着同一主体被并发建档，或配置刚被改动；两者都不能落成半截账户。
        if (isOidcLoginError(error)) return { kind: 'failed', code: error.code };
        if (error instanceof Error && /unique|duplicate/i.test(error.message)) return { kind: 'failed', code: 'provider-config-changed' };
        throw error;
      }
    },
  };
}

/** 每次成功登录都按选择器刷新档案（显示名、Git 名、邮箱与自定义字段），与 agent-workflow 的行为一致。 */
async function refreshExisting(deps: Deps, provider: OidcProviderRecord, claims: IdpClaims, profile: ResolvedProfile, userId: UserId, now: Date): Promise<UserDto> {
  return deps.uow.run(async (scope) => {
    const user = await scope.users.getById(userId);
    if (!user) throw new PlatformError('internal', '身份关联指向的用户已不存在');
    const updated: User = { ...user, name: profile.displayName, gitName: profile.gitName, email: profile.email ?? user.email, lastLoginAt: now };
    await scope.users.update(updated);
    await scope.identities.refresh({
      providerId: provider.id, subject: claims.subject, userId, email: profile.email, emailVerified: claims.emailVerified,
      profile: platformProfile(profile), preferredSnapshot: profile.displayName,
    }, now);
    return toDto(updated);
  });
}

async function createWithIdentity(deps: Deps, provider: OidcProviderRecord, claims: IdpClaims, profile: ResolvedProfile, now: Date): Promise<UserDto> {
  return deps.uow.run(async (scope) => {
    const username = await pickUsername(scope.users.getByUsername, { preferredUsername: claims.preferredUsername, email: profile.email, subject: claims.subject });
    const created: User = {
      id: newId('usr') as UserId,
      externalId: oidcExternalId(provider.id, claims.subject),
      username,
      name: profile.displayName,
      email: profile.email ?? `${username}@${provider.slug}.oidc.invalid`,
      gitName: profile.gitName,
      passwordHash: null,
      isAdmin: shouldBootstrapAdminForOidc(profile.email, deps.settings.adminEmails),
      createdAt: now,
      lastLoginAt: now,
    };
    // 用户与身份关联在同一事务里：并发的同主体登录必须整体回滚，不能留下一个没有身份的账户。
    await scope.users.insert(created);
    await scope.identities.link({
      providerId: provider.id, subject: claims.subject, userId: created.id, email: profile.email,
      emailVerified: claims.emailVerified, profile: platformProfile(profile), preferredSnapshot: profile.displayName,
    }, now);
    return toDto(created);
  });
}

/**
 * OIDC 建档的管理员判定只看安装配置里的邮箱白名单。
 * 「库里还没有用户时第一个登录者即管理员」这条在有引导向导之后就被取消了（RFC-005 B3）：
 * 引导阶段本来就不允许 OIDC 登录，留着它只会让任何人抢到管理员。
 */
function shouldBootstrapAdminForOidc(email: string | null, adminEmails: readonly string[]): boolean {
  return email !== null && shouldBootstrapAdmin(email, adminEmails, 1);
}

function platformProfile(profile: ResolvedProfile): Record<string, string> {
  return {
    name: profile.displayName,
    'git-name': profile.gitName,
    ...(profile.email === null ? {} : { email: profile.email }),
    ...profile.attrs,
  };
}

async function pickUsername(taken: (username: string) => Promise<unknown>, seed: { preferredUsername: string | null; email: string | null; subject: string }): Promise<string> {
  for (const candidate of usernameCandidates(seed)) {
    if (!(await taken(candidate))) return candidate;
  }
  return `oidc-${Date.now().toString(36)}`;
}
