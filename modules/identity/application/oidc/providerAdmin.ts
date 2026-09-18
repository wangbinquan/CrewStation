import type { CreateOidcProviderRequest, OidcProbeResult, OidcProviderDto, OidcProviderId, PatchOidcProviderRequest } from '@crewstation/contracts';
import { CreateOidcProviderRequestSchema, PatchOidcProviderRequestSchema } from '@crewstation/contracts';
import { conflict, forbidden, newId, notFound, validation } from '@crewstation/kernel';
import { blocksLastEnabledProvider } from '../../domain/loginMethods';
import type { OidcProviderPatch, OidcProviderRecord } from '../../ports/oidcRepositories';
import type { IdentityUseCaseDeps } from '../dependencies';

type Deps = Pick<IdentityUseCaseDeps, 'uow' | 'settings' | 'clock' | 'endpoints' | 'idp' | 'secrets'>;

export interface AdminActor {
  readonly isAdmin: boolean;
}

function requireAdmin(actor: AdminActor): void {
  if (!actor.isAdmin) throw forbidden('只有管理员可以管理身份提供方');
}

/** 管理员维护身份提供方（RFC-005 §6.2／§6.3）。密文只进不出，响应只回「是否已设置」。 */
export function providerAdminUseCases(deps: Deps) {
  return { ...providerReadUseCases(deps), ...providerWriteUseCases(deps), ...providerProbeUseCases(deps) };
}

function providerReadUseCases(deps: Deps) {
  return {
    listProviders: async (actor: AdminActor): Promise<OidcProviderDto[]> => {
      requireAdmin(actor);
      return (await deps.uow.read.providers.list()).map(toDto);
    },

    getProvider: async (actor: AdminActor, id: OidcProviderId): Promise<OidcProviderDto> => {
      requireAdmin(actor);
      const record = await deps.uow.read.providers.findById(id);
      if (!record) throw notFound('身份提供方', id);
      return toDto(record);
    },

  };
}

function providerWriteUseCases(deps: Deps) {
  const forcedOn = (): boolean => deps.settings.passwordLoginForcedOn === true;
  return {
    createProvider: async (actor: AdminActor, raw: unknown): Promise<OidcProviderDto> => {
      requireAdmin(actor);
      const request = parse(CreateOidcProviderRequestSchema, raw);
      assertMappingKeysUnique(request.claimMappings ?? []);
      const id = newId('idp') as OidcProviderId;
      const now = deps.clock.now();
      const clientSecretEnc = await deps.secrets.seal(request.clientSecret);
      return deps.uow.run(async (scope) => {
        if (await scope.providers.findBySlug(request.slug)) throw conflict(`标识 ${request.slug} 已被占用`, { code: 'oidc-slug-taken' });
        await scope.providers.insert({ ...defaults(request), id, clientSecretEnc }, now);
        const created = await scope.providers.findById(id);
        if (!created) throw notFound('身份提供方', id);
        return toDto(created);
      });
    },

    patchProvider: async (actor: AdminActor, id: OidcProviderId, raw: unknown): Promise<OidcProviderDto> => {
      requireAdmin(actor);
      const request = parse(PatchOidcProviderRequestSchema, raw);
      if (request.claimMappings) assertMappingKeysUnique(request.claimMappings);
      const now = deps.clock.now();
      const clientSecretEnc = request.clientSecret === undefined ? undefined : await deps.secrets.seal(request.clientSecret);
      return deps.uow.run(async (scope) => {
        const current = await scope.providers.findById(id);
        if (!current) throw notFound('身份提供方', id);
        if (request.slug !== undefined && request.slug !== current.slug) {
          const taken = await scope.providers.findBySlug(request.slug);
          if (taken) throw conflict(`标识 ${request.slug} 已被占用`, { code: 'oidc-slug-taken' });
        }
        // 主体字段一改就会给后续身份换命名空间：旧行可能查不到（重复建号）或撞上别人的旧主体（登成别人）。
        // 只要这个 Provider 还有关联身份就拒绝；判定与更新在同一事务内，进行中的回调只能排在它前或后。
        if (request.subjectClaim !== undefined && (request.subjectClaim ?? null) !== current.subjectClaim) {
          if ((await scope.identities.countByProvider(id)) > 0) {
            throw conflict('该身份提供方已有关联身份，不能再改主体字段；需要更换时请删除后重建', { code: 'subject-claim-locked-by-identities' });
          }
        }
        if (request.enabled === false && current.enabled) {
          const [policy, enabledProviderCount] = await Promise.all([scope.policy.read(), scope.providers.countEnabled()]);
          if (blocksLastEnabledProvider({ policy, forcedOn: forcedOn(), enabledProviderCount, providerWasEnabled: true })) {
            throw conflict('用户名密码登录已关闭，不能停用最后一个启用的身份提供方', { code: 'last-enabled-oidc-required' });
          }
        }
        await scope.providers.update(id, toPatch(request, clientSecretEnc), now);
        const updated = await scope.providers.findById(id);
        if (!updated) throw notFound('身份提供方', id);
        return toDto(updated);
      });
    },

    removeProvider: async (actor: AdminActor, id: OidcProviderId): Promise<void> => {
      requireAdmin(actor);
      await deps.uow.run(async (scope) => {
        const current = await scope.providers.findById(id);
        if (!current) throw notFound('身份提供方', id);
        const [policy, enabledProviderCount] = await Promise.all([scope.policy.read(), scope.providers.countEnabled()]);
        if (blocksLastEnabledProvider({ policy, forcedOn: forcedOn(), enabledProviderCount, providerWasEnabled: current.enabled })) {
          throw conflict('用户名密码登录已关闭，不能删除最后一个启用的身份提供方', { code: 'last-enabled-oidc-required' });
        }
        if ((await scope.identities.countByProvider(id)) > 0) {
          throw conflict('仍有用户关联着该身份提供方，删除会让他们无法登录', { code: 'provider-still-linked' });
        }
        await scope.providers.remove(id);
      });
    },

  };
}

function providerProbeUseCases(deps: Deps) {
  return {
    /** 测试连接：始终成功返回一份诊断，配置坏掉时逐项说明坏在哪。管理员按它时强制取新的 discovery。 */
    probeProvider: async (actor: AdminActor, id: OidcProviderId): Promise<OidcProbeResult> => {
      requireAdmin(actor);
      const provider = await deps.uow.read.providers.findById(id);
      if (!provider) throw notFound('身份提供方', id);
      const effective = await deps.endpoints.resolve(provider, { forceFresh: true });
      const subjectMode = provider.subjectClaim !== null;
      const profileMode = provider.usernameClaim !== null || provider.gitNameClaim !== null || provider.emailClaim !== null || provider.claimMappings.length > 0;
      const jwksReachable = !subjectMode && effective.jwksUri !== null ? await deps.idp.jwksReachable(effective.jwksUri) : undefined;
      const identityChannelReady = subjectMode
        ? effective.userinfoEndpoint !== null
        : profileMode
          ? effective.userinfoEndpoint !== null && (effective.jwksUri === null || jwksReachable === true)
          : effective.jwksUri !== null ? jwksReachable === true : effective.userinfoEndpoint !== null;
      const endpointOf = (url: string | null, source: 'discovery' | 'manual' | 'none'): { url: string; source: 'discovery' | 'manual' } | null =>
        url !== null && source !== 'none' ? { url, source } : null;
      return {
        ok: effective.authorizationEndpoint !== null && effective.tokenEndpoint !== null && identityChannelReady,
        discovery: { ok: effective.discoveryOk, ...(effective.discoveryError === undefined ? {} : { error: effective.discoveryError }) },
        issuer: effective.issuer,
        endpoints: {
          authorizationEndpoint: endpointOf(effective.authorizationEndpoint, effective.sources.authorizationEndpoint),
          tokenEndpoint: endpointOf(effective.tokenEndpoint, effective.sources.tokenEndpoint),
          userinfoEndpoint: endpointOf(effective.userinfoEndpoint, effective.sources.userinfoEndpoint),
          jwksUri: endpointOf(effective.jwksUri, effective.sources.jwksUri),
        },
        ...(jwksReachable === undefined ? {} : { jwksReachable }),
        scopesSupported: [...effective.scopesSupported],
      };
    },
  };
}

function parse<T>(schema: { safeParse(raw: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: Array<string | number | symbol>; message: string }> } } }, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  throw validation(`身份提供方参数不正确：${issues.map((i) => `${i.path || '$'}: ${i.message}`).join('；')}`, { issues });
}

/** 同一份配置里两个映射用同一个 key 会让转发头的值取决于遍历顺序，直接拒绝。 */
function assertMappingKeysUnique(mappings: ReadonlyArray<{ readonly key: string }>): void {
  const seen = new Set<string>();
  for (const mapping of mappings) {
    if (seen.has(mapping.key)) throw validation(`自定义字段 ${mapping.key} 重复`, { code: 'forwarding-field-invalid' });
    seen.add(mapping.key);
  }
}

function defaults(request: CreateOidcProviderRequest): Omit<OidcProviderRecord, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    slug: request.slug,
    displayName: request.displayName,
    issuerUrl: request.issuerUrl,
    clientId: request.clientId,
    scopes: request.scopes,
    provisioning: request.provisioning,
    allowedEmailDomains: request.allowedEmailDomains ?? [],
    iconUrl: request.iconUrl ?? null,
    authorizationEndpoint: request.authorizationEndpoint ?? null,
    tokenEndpoint: request.tokenEndpoint ?? null,
    userinfoEndpoint: request.userinfoEndpoint ?? null,
    jwksUri: request.jwksUri ?? null,
    userinfoRequestStyle: request.userinfoRequestStyle ?? 'get_bearer',
    trustEmailVerified: request.trustEmailVerified ?? false,
    usernameClaim: request.usernameClaim ?? null,
    gitNameClaim: request.gitNameClaim ?? null,
    emailClaim: request.emailClaim ?? null,
    subjectClaim: request.subjectClaim ?? null,
    claimMappings: request.claimMappings ?? [],
    enabled: request.enabled ?? true,
  };
}

function toPatch(request: PatchOidcProviderRequest, clientSecretEnc: string | undefined): OidcProviderPatch {
  const patch: Record<string, unknown> = {};
  for (const key of ['slug', 'displayName', 'issuerUrl', 'clientId', 'scopes', 'provisioning', 'allowedEmailDomains', 'iconUrl',
    'authorizationEndpoint', 'tokenEndpoint', 'userinfoEndpoint', 'jwksUri', 'userinfoRequestStyle', 'trustEmailVerified',
    'usernameClaim', 'gitNameClaim', 'emailClaim', 'subjectClaim', 'claimMappings', 'enabled'] as const) {
    const value = (request as Record<string, unknown>)[key];
    if (value !== undefined) patch[key] = value;
  }
  if (clientSecretEnc !== undefined) patch.clientSecretEnc = clientSecretEnc;
  return patch as OidcProviderPatch;
}

function toDto(record: OidcProviderRecord): OidcProviderDto {
  return {
    id: record.id,
    slug: record.slug,
    displayName: record.displayName,
    issuerUrl: record.issuerUrl,
    clientId: record.clientId,
    clientSecretSet: true,
    scopes: record.scopes,
    provisioning: record.provisioning,
    allowedEmailDomains: [...record.allowedEmailDomains],
    iconUrl: record.iconUrl,
    enabled: record.enabled,
    authorizationEndpoint: record.authorizationEndpoint,
    tokenEndpoint: record.tokenEndpoint,
    userinfoEndpoint: record.userinfoEndpoint,
    userinfoRequestStyle: record.userinfoRequestStyle,
    jwksUri: record.jwksUri,
    trustEmailVerified: record.trustEmailVerified,
    usernameClaim: record.usernameClaim,
    gitNameClaim: record.gitNameClaim,
    emailClaim: record.emailClaim,
    subjectClaim: record.subjectClaim,
    claimMappings: [...record.claimMappings],
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
