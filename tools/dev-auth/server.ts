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
  readonly routeId?: string;
  readonly clientSecret?: string;
  readonly seedRetries?: number;
  readonly seedRetryDelayMs?: number;
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

/**
 * 平台刚收下注册时，它自己的 Provider 与 JWKS 缓存还没换过来，首轮播种会撞上：
 * 前缀固定之后 issuer 不再变，缓存因此会活过 dev-auth 重启，而新进程换了签名 kid——
 * 现象是 `/start` 503（旧 issuer）或 `/callback` 400（旧公钥），几十秒后自行收敛。所以自动重试几轮再判失败。
 */
const SEED_RETRIES = 5;
const SEED_RETRY_DELAY_MS = 6000;

const responseHeaders = { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' };
const html = (body: string, status = 200): Response => new Response(body, { status, headers: responseHeaders });
const redirect = (location: string): Response => new Response(null, { status: 303, headers: { 'cache-control': 'no-store', location } });

export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && /^\/(?![\\/])[^\u0000-\u001f]*$/.test(value) ? value : '/';
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
  if (role.memberRole && (targetProjectId || role.key === 'tester') && !seeded.projects.some((project) => project.id === targetProjectId && project.state !== 'archived' && project.kind === 'DigitalWorker')) throw new Error('请选择一个可用的数字人项目');
  for (const project of seeded.projects) {
    if (project.ownerUserId === userId && role.platformRole !== 'user') continue;
    if (project.ownerUserId === userId) throw new Error(`固定角色已是项目「${project.name}」的负责人，开发入口不会自动转移所有权`);
    const current = (await platform.members(seeded.adminCookie, project.id)).find((member) => member.userId === userId);
    const wanted = role.memberRole && project.id === targetProjectId ? role.memberRole : null;
    if (current?.role === 'owner') throw new Error(`固定角色已是项目「${project.name}」的负责人，开发入口不会自动转移所有权`);
    if (wanted && current?.role !== wanted) await platform.setMember(seeded.adminCookie, project.id, userId, wanted);
    if (!wanted && current) await platform.removeMember(seeded.adminCookie, project.id, userId);
  }
}

/**
 * 管理员会话优先走自己的 OIDC：Provider 注册过之后，dev-auth 就不再需要平台开着密码登录，
 * 重启与滾镜像都能自愈。只有首次注册、或 Provider 漂了（issuer／口令被改、被停用，
 * 固定账户被降权）才回落密码登录，顺手把 Provider 重新写对。回落是不正常的，所以要记一笔。
 */
async function adminSession(platform: PlatformClient, oidc: DevOidc, routePrefix: string, issuer: string, clientSecret: string): Promise<string> {
  const admin = findDevRole('admin');
  if (!admin) throw new Error('开发角色表缺少管理员');
  try {
    const cookie = await authorizeRole(platform, oidc, routePrefix, admin, '/');
    if ((await platform.me(cookie)).platformRole === 'admin') return cookie;
    console.warn('[dev-auth] 固定管理员账户当前不是平台管理员，回落密码登录校准');
  } catch (error) {
    console.warn(`[dev-auth] 公司身份取管理员会话未成功，回落密码登录并重新注册 Provider：${error instanceof Error ? error.message : String(error)}`);
  }
  const cookie = await platform.loginAdmin();
  await platform.ensureProvider(cookie, issuer, clientSecret);
  return cookie;
}

async function seed(platform: PlatformClient, oidc: DevOidc, issuer: string, routePrefix: string, clientSecret: string): Promise<SeededState> {
  const adminCookie = await adminSession(platform, oidc, routePrefix, issuer, clientSecret);
  const users = new Map<string, string>();
  for (const role of DEV_ROLES) {
    const roleCookie = await authorizeRole(platform, oidc, routePrefix, role, '/');
    const current = await platform.me(roleCookie);
    users.set(role.key, current.id);
    if (current.platformRole !== role.platformRole) await platform.setPlatformRole(adminCookie, current.id, role.platformRole);
  }
  return { adminCookie, users, projects: await platform.projects(adminCookie) };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

function platformClientFrom(input: ServerOptions): PlatformClient {
  return new PlatformClient({
    origin: input.platformOrigin ?? process.env.CS_PLATFORM_ORIGIN ?? 'http://traefik.crewstation-system.svc.cluster.local',
    host: input.platformHost ?? process.env.CS_PLATFORM_HOST ?? 'console.cs.localhost',
    username: required(input.adminUsername ?? process.env.CS_ADMIN_USERNAME, 'CS_ADMIN_USERNAME'),
    password: required(input.adminPassword ?? process.env.CS_ADMIN_PASSWORD, 'CS_ADMIN_PASSWORD'),
  });
}

/**
 * 路径前缀与客户端口令必须能跨重启保持不变：写回平台的 `ensureProvider` 排在管理员登录之后，
 * 一旦每次启动现摇，库里那条 `dev-roles` 记录就会被任意一次重启废掉，而重新注册又反过来依赖登录。
 * 没配就退回临时值，但要在日志里看得见这次是降级的。
 */
export function devAuthOidcIdentity(input: Pick<ServerOptions, 'routeId' | 'clientSecret'> = {}): { readonly routePrefix: string; readonly clientSecret: string } {
  const routeId = input.routeId ?? process.env.CS_DEV_AUTH_ROUTE_ID;
  const clientSecret = input.clientSecret ?? process.env.CS_DEV_AUTH_CLIENT_SECRET;
  if (routeId !== undefined && !/^[a-z0-9]{8,64}$/.test(routeId)) throw new Error('CS_DEV_AUTH_ROUTE_ID 只接受 8–64 位小写字母或数字');
  if (!routeId || !clientSecret) console.warn('[dev-auth] 未配置 CS_DEV_AUTH_ROUTE_ID／CS_DEV_AUTH_CLIENT_SECRET：本次用临时值，重启后平台必须重新注册这个 Provider');
  return {
    routePrefix: `/oidc/${routeId ?? randomBytes(6).toString('hex')}`,
    clientSecret: clientSecret ?? randomBytes(32).toString('base64url'),
  };
}

export async function startDevAuthServer(input: ServerOptions = {}): Promise<StartedDevAuthServer> {
  const port = input.port ?? Number(process.env.CS_DEV_AUTH_PORT ?? 7460);
  const publicOrigin = input.publicOrigin ?? process.env.CS_DEV_AUTH_PUBLIC_ORIGIN ?? 'http://dev-auth.cs.localhost';
  const internalOrigin = input.internalOrigin ?? process.env.CS_DEV_AUTH_INTERNAL_ORIGIN ?? 'http://crewstation-dev-auth.crewstation-system.svc.cluster.local:7460';
  const consoleOrigin = input.consoleOrigin ?? process.env.CS_CONSOLE_ORIGIN ?? 'http://console.cs.localhost';
  const { routePrefix, clientSecret } = devAuthOidcIdentity(input);
  const actionToken = randomBytes(24).toString('base64url');
  const issuer = `${internalOrigin}${routePrefix}`;
  const oidc = await createDevOidc({ issuer: () => issuer, authorizationOrigin: () => publicOrigin, allowedRedirectOrigin: consoleOrigin, clientSecret });
  const platform = platformClientFrom(input);
  const seedRetries = input.seedRetries ?? SEED_RETRIES, seedRetryDelayMs = input.seedRetryDelayMs ?? SEED_RETRY_DELAY_MS;
  let pageState: DevAuthPageState = { status: 'pending', startedAt: Date.now(), projects: [] };
  let seeded: SeededState | undefined;
  let seeding: Promise<void> | undefined;
  let mutation = Promise.resolve();

  const startSeed = (attempt = 0): void => {
    if (seeding) return;
    pageState = { status: 'pending', startedAt: attempt === 0 ? Date.now() : pageState.startedAt, projects: [] };
    seeding = seed(platform, oidc, issuer, routePrefix, clientSecret).then((result) => {
      seeded = result;
      pageState = { status: 'ready', startedAt: pageState.startedAt, projects: selectableProjects(result.projects) };
    }).catch((error: unknown) => {
      seeded = undefined;
      const message = error instanceof Error ? error.message : String(error), again = attempt < seedRetries;
      pageState = { status: again ? 'pending' : 'error', startedAt: pageState.startedAt, projects: [], error: message };
      console.error(`[dev-auth] 准备失败（第 ${attempt + 1} 次${again ? '，稍后重试' : '，不再重试'}）：${message}`);
      if (again) setTimeout(() => startSeed(attempt + 1), seedRetryDelayMs).unref?.();
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
      await platform.setPlatformRole(seeded.adminCookie, userId, role.platformRole);
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
    // 就绪只代表 IdP 在服务：播种失败时仍要能进这个页面重试，也不能让网关把路由摘掉。
    if (url.pathname === '/readyz') return new Response(pageState.status === 'ready' ? 'ready\n' : `ready · 播种${pageState.status}\n`);
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
