import type { OidcProviderDto, ProjectId, UserId } from '@crewstation/contracts';

const userId = `usr_${'a'.repeat(32)}` as UserId;
const projectId = `prj_${'b'.repeat(32)}` as ProjectId;
const now = '2026-09-18T00:00:00.000Z';

export function provider(overrides: Partial<OidcProviderDto> = {}): OidcProviderDto {
  return {
    id: `idp_${'1'.repeat(32)}` as OidcProviderDto['id'],
    slug: 'corp-sso', displayName: '公司统一身份', issuerUrl: 'https://idp.corp.example', clientId: 'cs-platform', clientSecretSet: true,
    scopes: 'openid profile email', provisioning: 'allowlist', allowedEmailDomains: ['@corp.example'], iconUrl: null, enabled: true,
    authorizationEndpoint: null, tokenEndpoint: null, userinfoEndpoint: null, userinfoRequestStyle: 'get_bearer', jwksUri: null,
    trustEmailVerified: false, usernameClaim: null, gitNameClaim: null, emailClaim: null, subjectClaim: null, claimMappings: [],
    createdAt: now, updatedAt: now, ...overrides,
  };
}

/** 认证页的桩：登录策略、提供方、转发三条读，加上它们的写；不打桩真实后端。 */
export function adminAuthenticationFixture(options: { authMethod?: 'password' | 'oidc'; providers?: OidcProviderDto[]; forcedOn?: boolean; passwordLoginEnabled?: boolean } = {}) {
  const calls: Array<{ url: URL; method: string; body?: unknown }> = [];
  const state = {
    authMethod: options.authMethod ?? 'oidc',
    passwordLoginEnabled: options.passwordLoginEnabled ?? true,
    forcedOn: options.forcedOn ?? false,
    providers: options.providers ?? [provider()],
    globalFields: ['name', 'email'] as string[],
    projectFields: undefined as string[] | undefined,
    probeOk: true,
  };
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    let payload: unknown = { items: [] };
    let status = 200;
    if (url.pathname === '/v1/me') payload = { id: userId, name: '管理员', email: 'admin@corp.example', platformRole: 'admin', isAdmin: true, memberships: [], authMethod: state.authMethod };
    else if (url.pathname === '/v1/admin/auth/login-policy') {
      if (method === 'PUT') state.passwordLoginEnabled = Boolean((body as { passwordLoginEnabled?: boolean }).passwordLoginEnabled);
      payload = {
        passwordLoginEnabled: state.passwordLoginEnabled, bootstrapCompletedAt: now, forcedOn: state.forcedOn,
        enabledProviderCount: state.providers.filter((p) => p.enabled).length, callerAuthMethod: state.authMethod,
      };
    } else if (url.pathname === '/v1/admin/auth/providers' && method === 'POST') {
      const created = provider({ ...(body as Partial<OidcProviderDto>), id: `idp_${'2'.repeat(32)}` as OidcProviderDto['id'] });
      state.providers = [...state.providers, created];
      payload = created;
      status = 201;
    } else if (url.pathname === '/v1/admin/auth/providers') payload = { items: state.providers };
    else if (url.pathname.endsWith('/test')) {
      payload = {
        ok: state.probeOk, discovery: { ok: true }, issuer: 'https://idp.corp.example',
        endpoints: {
          authorizationEndpoint: { url: 'https://idp.corp.example/authorize', source: 'discovery' },
          tokenEndpoint: { url: 'https://idp.corp.example/token', source: 'discovery' },
          userinfoEndpoint: { url: 'https://idp.corp.example/userinfo', source: 'discovery' },
          jwksUri: { url: 'https://idp.corp.example/jwks', source: 'discovery' },
        },
        jwksReachable: true, scopesSupported: ['openid'],
      };
    } else if (url.pathname.startsWith('/v1/admin/auth/providers/') && method === 'PATCH') {
      const patch = body as Partial<OidcProviderDto>;
      state.providers = state.providers.map((p) => (url.pathname.endsWith(p.id) ? { ...p, ...patch } : p));
      payload = state.providers.find((p) => url.pathname.endsWith(p.id));
    } else if (url.pathname.startsWith('/v1/admin/auth/providers/') && method === 'DELETE') {
      state.providers = state.providers.filter((p) => !url.pathname.endsWith(p.id));
      status = 204;
      payload = null;
    } else if (url.pathname === '/v1/admin/auth/forwarding') {
      if (method === 'PUT') state.globalFields = (body as { fields: string[] }).fields;
      payload = {
        global: { fields: state.globalFields, updatedBy: userId, updatedAt: now },
        projects: state.projectFields === undefined ? [] : [{ projectId, fields: state.projectFields, updatedBy: userId, updatedAt: now }],
        candidates: [
          { key: 'name', kind: 'fixed', providers: [] },
          { key: 'email', kind: 'fixed', providers: [] },
          { key: 'git-name', kind: 'fixed', providers: [] },
          ...state.providers.flatMap((p) => p.claimMappings.map((m) => ({ key: m.key, kind: 'mapped' as const, providers: [p.slug] }))),
        ],
      };
    } else if (url.pathname.startsWith('/v1/admin/auth/forwarding/projects/')) {
      if (method === 'PUT') state.projectFields = (body as { fields: string[] }).fields;
      if (method === 'DELETE') state.projectFields = undefined;
      payload = { projectId, source: state.projectFields === undefined ? 'global' : 'project', fields: state.projectFields ?? state.globalFields, headers: [], tokenClaims: [] };
    }
    return new Response(payload === null ? null : JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, state, projectId, writes: () => calls.filter((c) => c.method !== 'GET') };
}
