import { randomBytes } from 'node:crypto';
import { createDevOidc } from './oidc';
import type { DevOidc } from './oidc';
import { renderDevAuthPage } from './page';
import type { DevAuthPageState, DevAuthProject } from './page';
import { PlatformClient } from './platform';
import type { PlatformProject } from './platform';
import { DEV_ROLES, findDevRole } from './roles';
import type { DevRole } from './roles';

interface ServerOptions {
  readonly port?: number;
  readonly publicOrigin?: string;
  readonly internalOrigin?: string;
  readonly consoleOrigin?: string;
  readonly platformOrigin?: string;
  readonly platformHost?: string;
  readonly adminUsername?: string;
  readonly adminPassword?: string;
}

interface SeededState {
  readonly adminCookie: string;
  readonly users: ReadonlyMap<string, string>;
  readonly projects: readonly PlatformProject[];
}

export interface StartedDevAuthServer {
  readonly port: number;
  readonly publicOrigin: string;
  readonly routePrefix: string;
  stop(): void;
}

const responseHeaders = { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' };
const html = (body: string, status = 200): Response => new Response(body, { status, headers: responseHeaders });
const redirect = (location: string): Response => new Response(null, { status: 303, headers: { 'cache-control': 'no-store', location } });

export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && /^\/(?![\\/])[^\u0000-\u001f]*$/.test(value) ? value : '/projects';
}

export function selectableProjects(projects: readonly PlatformProject[]): readonly DevAuthProject[] {
  return projects.filter((project) => project.state !== 'archived' && project.kind === 'DigitalWorker').map(({ id, name, slug, kind }) => ({ id, name, slug, kind }));
}

async function authorizeRole(platform: PlatformClient, oidc: DevOidc, routePrefix: string, role: DevRole, returnTo: string): Promise<string> {
  const authorization = new URL(await platform.startAuthorization(returnTo));
  authorization.searchParams.set('as', role.sub);
  const approved = await oidc.fetch(new Request(authorization), routePrefix);
  const callback = approved.headers.get('location');
  if (!callback || approved.status !== 302) throw new Error(`开发 IdP 未返回回调地址（HTTP ${approved.status}）`);
  return platform.completeAuthorization(callback);
}

async function reconcileMemberships(platform: PlatformClient, seeded: SeededState, role: DevRole, userId: string, targetProjectId?: string): Promise<void> {
  if (role.memberRole && !seeded.projects.some((project) => project.id === targetProjectId && project.state !== 'archived' && project.kind === 'DigitalWorker')) throw new Error('请选择一个可用的数字人项目');
  for (const project of seeded.projects) {
    if (project.ownerUserId === userId) throw new Error(`固定角色已是项目「${project.name}」的负责人，开发入口不会自动转移所有权`);
    const current = (await platform.members(seeded.adminCookie, project.id)).find((member) => member.userId === userId);
    const wanted = role.memberRole && project.id === targetProjectId ? role.memberRole : null;
    if (current?.role === 'owner') throw new Error(`固定角色已是项目「${project.name}」的负责人，开发入口不会自动转移所有权`);
    if (wanted && current?.role !== wanted) await platform.setMember(seeded.adminCookie, project.id, userId, wanted);
    if (!wanted && current) await platform.removeMember(seeded.adminCookie, project.id, userId);
  }
}

async function seed(platform: PlatformClient, oidc: DevOidc, issuer: string, routePrefix: string, clientSecret: string): Promise<SeededState> {
  const adminCookie = await platform.loginAdmin();
  await platform.ensureProvider(adminCookie, issuer, clientSecret);
  const users = new Map<string, string>();
  for (const role of DEV_ROLES) {
    const roleCookie = await authorizeRole(platform, oidc, routePrefix, role, '/');
    const current = await platform.me(roleCookie);
    users.set(role.key, current.id);
    if (current.isAdmin !== role.isAdmin) await platform.setAdmin(adminCookie, current.id, role.isAdmin);
  }
  return { adminCookie, users, projects: await platform.projects(adminCookie) };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

export async function startDevAuthServer(input: ServerOptions = {}): Promise<StartedDevAuthServer> {
  const port = input.port ?? Number(process.env.CS_DEV_AUTH_PORT ?? 7460);
  const publicOrigin = input.publicOrigin ?? process.env.CS_DEV_AUTH_PUBLIC_ORIGIN ?? 'http://dev-auth.cs.localhost';
  const internalOrigin = input.internalOrigin ?? process.env.CS_DEV_AUTH_INTERNAL_ORIGIN ?? 'http://crewstation-dev-auth.crewstation-system.svc.cluster.local:7460';
  const consoleOrigin = input.consoleOrigin ?? process.env.CS_CONSOLE_ORIGIN ?? 'http://console.cs.localhost';
  const routePrefix = `/oidc/${randomBytes(6).toString('hex')}`;
  const actionToken = randomBytes(24).toString('base64url');
  const clientSecret = randomBytes(32).toString('base64url');
  const issuer = `${internalOrigin}${routePrefix}`;
  const oidc = await createDevOidc({ issuer: () => issuer, authorizationOrigin: () => publicOrigin, allowedRedirectOrigin: consoleOrigin, clientSecret });
  const platform = new PlatformClient({
    origin: input.platformOrigin ?? process.env.CS_PLATFORM_ORIGIN ?? 'http://traefik.crewstation-system.svc.cluster.local',
    host: input.platformHost ?? process.env.CS_PLATFORM_HOST ?? 'console.cs.localhost',
    username: required(input.adminUsername ?? process.env.CS_ADMIN_USERNAME, 'CS_ADMIN_USERNAME'),
    password: required(input.adminPassword ?? process.env.CS_ADMIN_PASSWORD, 'CS_ADMIN_PASSWORD'),
  });
  let pageState: DevAuthPageState = { status: 'pending', startedAt: Date.now(), projects: [] };
  let seeded: SeededState | undefined;
  let seeding: Promise<void> | undefined;
  let mutation = Promise.resolve();

  const startSeed = (): void => {
    if (seeding) return;
    pageState = { status: 'pending', startedAt: Date.now(), projects: [] };
    seeding = seed(platform, oidc, issuer, routePrefix, clientSecret).then((result) => {
      seeded = result;
      pageState = { status: 'ready', startedAt: pageState.startedAt, projects: selectableProjects(result.projects) };
    }).catch((error: unknown) => {
      seeded = undefined;
      pageState = { status: 'error', startedAt: pageState.startedAt, projects: [], error: error instanceof Error ? error.message : String(error) };
      console.error(`[dev-auth] 准备失败：${pageState.error}`);
    }).finally(() => { seeding = undefined; });
  };

  const login = async (request: Request, role: DevRole): Promise<Response> => {
    if (!seeded || pageState.status !== 'ready') return html(renderDevAuthPage(pageState, actionToken), 503);
    const form = await request.formData();
    if (form.get('csrf') !== actionToken) return html(renderDevAuthPage({ ...pageState, notice: '此前页面的安全令牌已失效，请重新点击要切换的角色。' }, actionToken), 403);
    const projectId = typeof form.get('projectId') === 'string' ? form.get('projectId') as string : undefined;
    const returnTo = safeReturnTo(form.get('returnTo'));
    let location = '';
    const action = async (): Promise<void> => {
      const userId = seeded?.users.get(role.key);
      if (!seeded || !userId) throw new Error('开发角色尚未准备完成');
      await platform.setAdmin(seeded.adminCookie, userId, role.isAdmin);
      await reconcileMemberships(platform, seeded, role, userId, projectId);
      const authorization = new URL(await platform.startAuthorization(returnTo));
      authorization.searchParams.set('as', role.sub);
      location = authorization.toString();
    };
    mutation = mutation.then(action, action);
    try {
      await mutation;
      return redirect(location);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return html(renderDevAuthPage({ ...pageState, status: 'error', error: message }, actionToken), 409);
    }
  };

  const server = Bun.serve({ port, hostname: '0.0.0.0', fetch: async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith(routePrefix)) return oidc.fetch(request, routePrefix);
    if (url.pathname === '/' && request.method === 'GET') return html(renderDevAuthPage(pageState, actionToken));
    if (url.pathname === '/healthz') return new Response('ok\n');
    if (url.pathname === '/readyz') return new Response(pageState.status === 'ready' ? 'ready\n' : `${pageState.status}\n`, { status: pageState.status === 'ready' ? 200 : 503 });
    if (url.pathname === '/status.json') return new Response(JSON.stringify(pageState), { headers: { 'cache-control': 'no-store', 'content-type': 'application/json' } });
    if (url.pathname === '/reseed' && request.method === 'POST') {
      const form = await request.formData();
      if (form.get('csrf') !== actionToken) return html(renderDevAuthPage({ ...pageState, notice: '此前页面的安全令牌已失效，请重新点击同步项目。' }, actionToken), 403);
      startSeed(); return redirect('/');
    }
    const match = request.method === 'POST' ? url.pathname.match(/^\/login\/([a-z]+)$/) : null;
    const role = findDevRole(match?.[1]);
    if (role) return login(request, role);
    return new Response('not found\n', { status: 404 });
  } });
  queueMicrotask(startSeed);
  return { port: server.port ?? port, publicOrigin, routePrefix, stop: () => server.stop(true) };
}
