/**
 * 本机脚本以平台管理员身份调用集群管理（RFC-010）的运维操作：rebuild-old-range-pods.ts 用它重建任务 Pod。
 *
 * 登录顺序：先用口令（CS_ADMIN_USERNAME／CS_ADMIN_PASSWORD，或显式无人值守安装写出的 .local/admin.env，与 admin-credentials.sh 同一顺序）；
 * 口令没有或登录被拒时，走本机开发角色登录器（dev-roles）以「开发环境 · 平台管理员」登录——管理员关掉口令登录之后，本机只剩这条路。
 * 两条都要求登录后的身份确实是平台管理员。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ActionCapability { action: string; enabled: boolean; reason: string }
export interface TaskResource { resourceId: string; uid: string; purpose: string; taskId?: string; parentTaskId?: string; availableActions: ActionCapability[] }
export interface ClusterOps {
  findPod(pod: { namespace: string; name: string; uid: string }): Promise<TaskResource | undefined>;
  run(resource: TaskResource, action: 'restart' | 'delete', idempotencyKey: string): Promise<{ phase: string; reason: string }>;
}
export interface HttpDeps {
  fetch: typeof fetch; consoleUrl: string; root: string; env: Record<string, string | undefined>;
  sleep: (ms: number) => Promise<void>; now: () => number;
}

/** 开发角色登录器里平台管理员那个角色的 sub（tools/dev-auth/roles.ts）。 */
export const DEV_ADMIN_SUB = 'dev-role-admin';
const TERMINAL_PHASES = new Set(['succeeded', 'failed', 'needs-attention']);

export function adminCredentials(root: string, env: Record<string, string | undefined>): { username: string; password: string } | undefined {
  const file = join(root, '.local/admin.env'), text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const fromFile = (key: string) => text.split('\n').find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1).trim();
  const username = env.CS_ADMIN_USERNAME || fromFile('CS_BOOTSTRAP_ADMIN_USERNAME') || 'platform-admin';
  const password = env.CS_ADMIN_PASSWORD || fromFile('CS_BOOTSTRAP_ADMIN_PASSWORD');
  return password ? { username, password } : undefined;
}

function sessionCookie(response: Response): string {
  const lines = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  for (const line of lines) {
    const match = line.match(/(?:^|,\s*)(cs_session=[^;,\s]+)/);
    if (match?.[1]) return match[1];
  }
  throw new Error(`响应没有 cs_session（HTTP ${response.status}）`);
}

async function detail(response: Response): Promise<string> {
  const text = (await response.text()).slice(0, 300);
  try { const body = JSON.parse(text) as { message?: string; error?: { message?: string } }; return body.error?.message ?? body.message ?? text; } catch { return text; }
}

async function passwordLogin(deps: HttpDeps, credentials: { username: string; password: string }): Promise<string> {
  const response = await deps.fetch(`${deps.consoleUrl}/auth/login`, {
    method: 'POST', redirect: 'manual', headers: { accept: 'application/json' },
    body: new URLSearchParams({ username: credentials.username, password: credentials.password }),
  });
  if (response.status >= 400) throw new Error(`HTTP ${response.status} ${await detail(response)}`);
  return sessionCookie(response);
}

/** 平台发起授权 → 开发 IdP 按 as=角色 直接批准并回跳 → 平台回调发会话 Cookie。与 tools/dev-auth 取管理员会话是同一条链路。 */
async function devRoleLogin(deps: HttpDeps): Promise<string> {
  const start = await deps.fetch(`${deps.consoleUrl}/auth/oidc/dev-roles/start?returnTo=%2F`, { redirect: 'manual' });
  const authorize = start.headers.get('location');
  if (!authorize) throw new Error(`平台没有给出开发角色的授权地址（HTTP ${start.status} ${await detail(start)}）`);
  const url = new URL(authorize, deps.consoleUrl);
  url.searchParams.set('as', DEV_ADMIN_SUB);
  const approved = await deps.fetch(url, { redirect: 'manual' });
  const callback = approved.headers.get('location');
  if (approved.status !== 302 || !callback) throw new Error(`开发角色登录器没有回跳（HTTP ${approved.status} ${await detail(approved)}）`);
  return sessionCookie(await deps.fetch(new URL(callback, deps.consoleUrl), { redirect: 'manual' }));
}

export async function adminSession(deps: HttpDeps): Promise<string> {
  const problems: string[] = [], credentials = adminCredentials(deps.root, deps.env);
  const attempts: [string, () => Promise<string>][] = [
    ...(credentials ? [['口令登录', () => passwordLogin(deps, credentials)] as [string, () => Promise<string>]] : []),
    ['开发角色登录', () => devRoleLogin(deps)],
  ];
  for (const [name, attempt] of attempts) {
    try {
      const cookie = await attempt();
      const me = await deps.fetch(`${deps.consoleUrl}/v1/me`, { headers: { accept: 'application/json', cookie } });
      const role = me.ok ? ((await me.json()) as { platformRole?: string }).platformRole : undefined;
      if (role === 'admin') return cookie;
      problems.push(`${name}：登录后的身份不是平台管理员（${role ?? `HTTP ${me.status}`}）`);
    } catch (error) { problems.push(`${name}：${error instanceof Error ? error.message : String(error)}`); }
  }
  throw new Error(problems.join('；'));
}

export function httpClusterOps(deps: HttpDeps, cookie: string): ClusterOps {
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await deps.fetch(`${deps.consoleUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { accept: 'application/json', cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`${body === undefined ? 'GET' : 'POST'} ${path}：HTTP ${response.status} ${await detail(response)}`);
    return response.json() as Promise<T>;
  };
  const lookup = async (pod: { namespace: string; name: string; uid: string }) => {
    const query = new URLSearchParams({ kind: 'Pod', namespace: pod.namespace, q: pod.name, limit: '100' });
    return (await call<{ items: TaskResource[] }>(`/v1/admin/cluster/resources?${query}`)).items.find((item) => item.uid === pod.uid);
  };
  return {
    // 盘点是定期快照：找不到就请求刷新，再等它出现（最多 90 秒）。
    findPod: async (pod) => {
      let found = await lookup(pod);
      if (found) return found;
      await call('/v1/admin/cluster/refresh', {});
      for (const deadline = deps.now() + 90_000; !found && deps.now() < deadline;) { await deps.sleep(3000); found = await lookup(pod); }
      return found;
    },
    run: async (resource, action, idempotencyKey) => {
      const inspection = await call<{ inspectionId: string; capability: ActionCapability }>(`/v1/admin/cluster/resources/${encodeURIComponent(resource.resourceId)}/inspect-operation`, { action });
      if (!inspection.capability.enabled) return { phase: 'skipped', reason: inspection.capability.reason };
      let op = await call<{ operationId: string; phase: string; reason: string }>('/v1/admin/cluster/operations', { inspectionId: inspection.inspectionId, idempotencyKey, params: { action } });
      for (const deadline = deps.now() + 600_000; !TERMINAL_PHASES.has(op.phase);) {
        if (deps.now() >= deadline) return { phase: op.phase, reason: `十分钟内没有结束：${op.reason}` };
        await deps.sleep(2000);
        op = await call(`/v1/admin/cluster/operations/${encodeURIComponent(op.operationId)}`);
      }
      return { phase: op.phase, reason: op.reason };
    },
  };
}
