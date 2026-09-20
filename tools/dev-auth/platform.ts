import { DEV_OIDC_CLIENT_ID } from './oidc';

interface Items<T> { readonly items: readonly T[] }
export interface PlatformUser { readonly id: string; readonly name: string; readonly email: string; readonly isAdmin: boolean; readonly platformRole: 'user' | 'developer' | 'admin' }
export interface CurrentPlatformUser extends PlatformUser { readonly memberships: readonly { projectId: string; role: 'owner' | 'developer' | 'tester' }[] }
export interface PlatformProject { readonly id: string; readonly slug: string; readonly name: string; readonly kind: string; readonly state: string; readonly ownerUserId: string }
export interface PlatformMember { readonly userId: string; readonly role: 'owner' | 'developer' | 'tester'; readonly name: string; readonly email: string }
interface Provider { readonly id: string; readonly slug: string }

interface PlatformClientOptions {
  readonly origin: string;
  readonly host: string;
  readonly username: string;
  readonly password: string;
}

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly cookie?: string;
  readonly redirect?: RequestRedirect;
}

export class PlatformApiError extends Error {
  constructor(readonly status: number, readonly path: string, detail: string) {
    super(`CrewStation ${status} ${path}：${detail}`);
    this.name = 'PlatformApiError';
  }
}

function sessionCookie(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? '';
  const match = raw.match(/(?:^|,\s*)(cs_session=[^;,\s]+)/);
  if (!match?.[1]) throw new PlatformApiError(response.status, new URL(response.url).pathname, '响应没有 cs_session Cookie');
  return match[1];
}

async function errorDetail(response: Response): Promise<string> {
  const text = (await response.text()).slice(0, 500);
  try {
    const body = JSON.parse(text) as { message?: string; error?: { message?: string } };
    return body.error?.message ?? body.message ?? (text || response.statusText);
  } catch {
    return text || response.statusText;
  }
}

export class PlatformClient {
  constructor(private readonly options: PlatformClientOptions) {}

  private async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const headers = new Headers({ accept: 'application/json', host: this.options.host });
    if (options.cookie) headers.set('cookie', options.cookie);
    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(options.body);
    }
    const response = await fetch(new URL(path, this.options.origin), {
      method: options.method ?? 'GET', headers, body, redirect: options.redirect ?? 'follow',
    });
    if (!response.ok && !(options.redirect === 'manual' && response.status >= 300 && response.status < 400)) {
      throw new PlatformApiError(response.status, path, await errorDetail(response));
    }
    return response;
  }

  async loginAdmin(): Promise<string> {
    const response = await this.request('/auth/login', {
      method: 'POST', redirect: 'manual', body: { username: this.options.username, password: this.options.password, returnTo: '/' },
    });
    return sessionCookie(response);
  }

  async ensureProvider(cookie: string, issuerUrl: string, clientSecret: string): Promise<void> {
    const providers = await this.json<Items<Provider>>(await this.request('/v1/admin/auth/providers', { cookie }));
    const existing = providers.items.find((provider) => provider.slug === 'dev-roles');
    const body = {
      slug: 'dev-roles', displayName: '本机开发角色', issuerUrl, clientId: DEV_OIDC_CLIENT_ID, clientSecret,
      scopes: 'openid profile email', provisioning: 'auto', allowedEmailDomains: [], enabled: true, userinfoRequestStyle: 'get_bearer',
      trustEmailVerified: true, usernameClaim: 'preferred_username', gitNameClaim: 'name', emailClaim: 'email', subjectClaim: 'sub', claimMappings: [],
    };
    const path = existing ? `/v1/admin/auth/providers/${encodeURIComponent(existing.id)}` : '/v1/admin/auth/providers';
    await this.request(path, { method: existing ? 'PATCH' : 'POST', cookie, body });
  }

  async startAuthorization(returnTo: string): Promise<string> {
    const query = new URLSearchParams({ returnTo });
    const response = await this.request(`/auth/oidc/dev-roles/start?${query}`, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (!location) throw new PlatformApiError(response.status, '/auth/oidc/dev-roles/start', '响应没有授权跳转地址');
    return location;
  }

  async completeAuthorization(location: string): Promise<string> {
    const target = new URL(location);
    const response = await this.request(`${target.pathname}${target.search}`, { redirect: 'manual' });
    return sessionCookie(response);
  }

  async me(cookie: string): Promise<CurrentPlatformUser> {
    return this.json(await this.request('/v1/me', { cookie }));
  }

  async setPlatformRole(cookie: string, userId: string, platformRole: PlatformUser['platformRole']): Promise<void> {
    const users = (await this.json<Items<PlatformUser>>(await this.request('/v1/users', { cookie }))).items;
    const current = users.find((user) => user.id === userId);
    if (!current) throw new Error('开发角色用户不存在');
    if (current.platformRole === platformRole) return;
    await this.request(`/v1/users/${encodeURIComponent(userId)}/platform-role`, { method: 'PUT', cookie, body: { platformRole, expectedRole: current.platformRole } });
  }

  async projects(cookie: string): Promise<readonly PlatformProject[]> {
    return (await this.json<Items<PlatformProject>>(await this.request('/v1/projects', { cookie }))).items;
  }

  async members(cookie: string, projectId: string): Promise<readonly PlatformMember[]> {
    const path = `/v1/projects/${encodeURIComponent(projectId)}/members`;
    return (await this.json<Items<PlatformMember>>(await this.request(path, { cookie }))).items;
  }

  async setMember(cookie: string, projectId: string, userId: string, role: 'developer' | 'tester'): Promise<void> {
    const path = `/v1/projects/${encodeURIComponent(projectId)}/members`;
    await this.request(path, { method: 'PUT', cookie, body: { userId, role } });
  }

  async removeMember(cookie: string, projectId: string, userId: string): Promise<void> {
    const path = `/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`;
    await this.request(path, { method: 'DELETE', cookie });
  }

  private async json<T>(response: Response): Promise<T> {
    return response.json() as Promise<T>;
  }
}
