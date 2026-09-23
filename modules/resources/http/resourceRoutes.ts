import type { Actor, ResourceStreamEvent, UserId } from '@crewstation/contracts';
import { AdminResourceViewQuerySchema, ResourceActionParamsSchema, ResourceActionRequestSchema, ResourceProjectParamsSchema, ResourceStreamCursorSchema, ResourceViewQuerySchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, mapErrorToResponse, parseBody, parseParams } from '@crewstation/http';
import { validation } from '@crewstation/kernel';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ResourcesModuleApi } from '../api/moduleApi';
import type { RecordFilter, ViewerAccess } from '../api/types';

type ViewQuery = ReturnType<typeof ResourceViewQuerySchema.parse> & { readonly projectId?: string };

/** 查询参数里去掉续传游标再按视图的 Schema 校验（EventSource 不能带自定义头，游标可以走查询参数）。 */
function viewQuery(c: Context<AppEnv>, admin: boolean): { readonly query: ViewQuery; readonly cursor?: number } {
  const { cursor: cursorParam, ...rest } = c.req.query();
  const parsed = (admin ? AdminResourceViewQuerySchema : ResourceViewQuerySchema).safeParse(rest);
  if (!parsed.success) throw validation(`query 校验失败：${parsed.error.issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('；')}`);
  const raw = c.req.header('last-event-id') ?? cursorParam;
  const cursor = raw === undefined || raw === '' ? undefined : ResourceStreamCursorSchema.safeParse(raw);
  if (cursor && !cursor.success) throw validation('续传游标必须是非负整数');
  return { query: parsed.data, ...(cursor ? { cursor: cursor.data } : {}) };
}

function filterOf(query: ViewQuery, projectId?: string): RecordFilter {
  const project = projectId ?? query.projectId;
  return { ...(project ? { projectId: project as RecordFilter['projectId'] } : {}), ...(query.kind ? { kind: query.kind } : {}), ...(query.parent ? { parentId: query.parent } : {}), includeStopped: query.includeStopped === 'true' };
}

/** 推送流是长连接：关掉 Bun 默认 10 秒的空闲断开，靠 15 秒一次的心跳维持经网关的连接（设计 §8.1）。 */
function keepOpen(c: Context<AppEnv>): void {
  const server = c.env as { timeout?: (request: Request, seconds: number) => void } | undefined;
  server?.timeout?.(c.req.raw, 0);
}

const encode = (event: ResourceStreamEvent) => ({ event: event.type, data: JSON.stringify(event), ...('cursor' in event ? { id: String(event.cursor) } : {}) });

function openStream(c: Context<AppEnv>, api: ResourcesModuleApi, input: { actor: Actor; filter: RecordFilter; access: ViewerAccess; cursor?: number; reauthorize(): Promise<void> }): Response {
  keepOpen(c);
  c.header('X-Accel-Buffering', 'no');
  return streamSSE(c, async (stream) => {
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    stream.onAbort(() => finish());
    const subscription = await api.subscribe({
      userId: input.actor.userId, filter: input.filter, access: input.access, ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      send: (event) => stream.writeSSE(encode(event)), reauthorize: input.reauthorize, close: () => finish(),
    });
    await done;
    subscription.close();
  });
}

/** 标准资源视图与推送流（设计 §4.2、§8）：项目成员看项目的，管理员看全平台的；可做操作统一受理。 */
export function resourceRoutes(api: ResourcesModuleApi, isAdmin: (id: string) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.onError((error, c) => mapErrorToResponse(error, c));
  const actor = async (c: Context<AppEnv>): Promise<Actor> => { const a = await actorFrom(c, isAdmin); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  r.get('/v1/projects/:projectId/resources/stream', async (c) => {
    const who = await actor(c);
    const { projectId } = parseParams(c, ResourceProjectParamsSchema);
    const { query, cursor } = viewQuery(c, false);
    const access = await api.projectAccess(who, projectId);
    api.checkStreamCapacity(who.userId);
    return openStream(c, api, { actor: who, filter: filterOf(query, projectId), access, ...(cursor !== undefined ? { cursor } : {}), reauthorize: async () => { await api.projectAccess({ ...who, isAdmin: await isAdmin(who.userId) }, projectId); } });
  });
  r.get('/v1/projects/:projectId/resources', async (c) => {
    const who = await actor(c);
    const { projectId } = parseParams(c, ResourceProjectParamsSchema);
    return c.json(await api.view(who, projectId, viewQuery(c, false).query));
  });
  r.get('/v1/admin/resources/stream', async (c) => {
    const who = await actor(c);
    const { query, cursor } = viewQuery(c, true);
    const access = await api.adminAccess(who);
    api.checkStreamCapacity(who.userId);
    return openStream(c, api, { actor: who, filter: filterOf(query), access, ...(cursor !== undefined ? { cursor } : {}), reauthorize: async () => { await api.adminAccess({ ...who, isAdmin: await isAdmin(who.userId) }); } });
  });
  r.get('/v1/admin/resources', async (c) => c.json(await api.adminView(await actor(c), viewQuery(c, true).query)));
  r.post('/v1/resources/:resourceId/actions/:action', async (c) => {
    const who = await actor(c);
    const { resourceId, action } = parseParams(c, ResourceActionParamsSchema);
    return c.json(await api.performAction(who, resourceId, action, await parseBody(c, ResourceActionRequestSchema)), 202);
  });
  return r;
}
