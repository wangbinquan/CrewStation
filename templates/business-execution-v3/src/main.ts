import { Platform, PlatformError, type Fence, type Subtask, type Task } from './client';
import { Controller, digest } from './control';
import { Store } from './store';

const json = (value: unknown, status = 200) => Response.json(value, { status });
const id = (value: unknown): string => { if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('资源 ID 无效'); return value; };
// Port opens before DB recovery; startup/readiness use DB reachability, liveness only proves process responsiveness.
export function createHandler(store: Store, platform: Platform, control: Controller) { return async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (url.pathname === '/live') return json({ alive: true });
  if (url.pathname === '/ready') return json({ ready: await store.ready() }, await store.ready() ? 200 : 503);
  if (!request.headers.has('x-cs-user-id') && !request.headers.has('x-cs-source-service')) return json({ error: '需要网关身份' }, 401);
  try {
    if (request.method === 'GET' && url.pathname === '/state') return json({ instanceId: control.instanceId, control: control.current ?? null });
    if (request.method === 'GET' && url.pathname === '/events') {
      const query = new URLSearchParams({ limit: '100', ...(url.searchParams.has('after') ? { after: url.searchParams.get('after')! } : {}) });
      return json(await platform.call(`/v3/business-tasks/${id(url.searchParams.get('taskId'))}/events?${query}`));
    }
    if (request.method === 'GET' && url.pathname === '/task') return json(await platform.call(`/v3/business-tasks/${id(url.searchParams.get('taskId'))}`));
    if (request.method === 'GET' && url.pathname === '/proof') return json(await platform.call(`/v3/business-tasks/${id(url.searchParams.get('taskId'))}/file?path=proof.txt`));
    if (request.method !== 'POST' || !['/actions', '/drain'].includes(url.pathname)) return json({ error: '不存在的入口' }, 404);
    const input = await request.json() as Record<string, unknown>;
    if (typeof input.requestKey !== 'string' || input.requestKey.length < 1 || input.requestKey.length > 100) return json({ error: '必须提供稳定 requestKey' }, 400);
    if (url.pathname === '/drain') {
      const stopAuthority = control.stopAuthority, root = `/v3/business-tasks/${id(input.taskId)}`, requestKey = input.requestKey;
      if (input.action === 'cancel') return json(await platform.call(`${root}/subtasks/${id(input.subtaskId)}/cancel`, { requestKey, expectedAttempt: input.expectedAttempt, stopAuthority }));
      if (['pause', 'close'].includes(String(input.action))) return json(await platform.call(`${root}/${input.action}`, { requestKey, expectedGeneration: input.expectedGeneration, stopAuthority }));
      return json({ error: '迁移排空只支持取消、暂停和关闭' }, 400);
    }
    const fence = control.fence, old = await store.admit(input.requestKey, digest(input), fence);
    if (old) return json(old);
    const result = await perform(platform, input, fence);
    await store.record(input.requestKey, result, fence); return json(result);
  } catch (error) { return error instanceof PlatformError ? json(error.body, error.status) : json({ error: error instanceof Error ? error.message : '动作失败' }, 409); }
}; }

if (import.meta.main) {
  const store = new Store(required('CS_DATABASE_URL')), platform = new Platform(required('CS_PLATFORM_API_URL')), control = new Controller(platform, store);
  const server = Bun.serve({ hostname: '0.0.0.0', port: Number(process.env.PORT ?? 3000), fetch: createHandler(store, platform, control) });
  setInterval(() => void control.tick(), 5000); void control.tick();
  process.on('SIGTERM', () => { void server.stop().then(() => process.exit(0)); });
}

async function perform(platform: Platform, input: Record<string, unknown>, fence: Fence): Promise<unknown> {
  const requestKey = input.requestKey as string;
  if (input.action === 'command') {
    const task = await platform.call<Task>('/v3/business-tasks', { requestKey: `${requestKey}:parent`, taskContractVersion: 'sample-v1', volumeMode: 'persistent', fence });
    // Retry the same key if creation has not become ready; never generate a new parent because a reply was lost.
    const child = await platform.call<Subtask>(`/v3/business-tasks/${task.id}/subtasks`, { kind: 'command', requestKey: `${requestKey}:command`, name: 'ninety-seconds', argv: ['sh', '-c', 'printf "first\\n"; sleep 90; printf "last\\n"; printf preserved > /work/proof.txt'], env: {}, timeoutSeconds: 120, fence });
    return { task, child };
  }
  const taskId = id(input.taskId), root = `/v3/business-tasks/${taskId}`;
  if (input.action === 'cancel') return platform.call(`${root}/subtasks/${id(input.subtaskId)}/cancel`, { requestKey, expectedAttempt: input.expectedAttempt, fence });
  if (['pause', 'resume', 'close'].includes(String(input.action))) return platform.call(`${root}/${input.action}`, { requestKey, expectedGeneration: input.expectedGeneration, fence });
  throw new Error('未知动作');
}
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`缺少 ${name}`); return value; }
