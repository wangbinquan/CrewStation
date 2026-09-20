import { expect, test } from 'bun:test';
import { ApiInvocationResponseSchema, IDENTITY_HEADERS } from '../../packages/contracts/index';
import { createApiClient } from '../../packages/api-client/index';
import { createApp } from '../../packages/http/index';
import { forbidden } from '../../packages/kernel/index';
import { createSessionClient } from '../../packages/session-client/index';
import { createTestDatabase, testDatabaseAvailable } from '../../packages/testkit/index';
import type { TestDatabase } from '../../packages/testkit/index';
import { createDevSessionModule, devSessionMigrations } from '../../modules/dev-session/index';
import { createSessionModule, sessionMigrations } from '../../modules/session/index';
import { workspaceActor, workspaceFixture, workspaceProject, workspaceTask } from '../../modules/dev-session/tests/workspaceFixture';
import { startTestRunner } from '../../runtimes/task/tests/testRunner';

const available = await testDatabaseAvailable();

function startSession(db: TestDatabase) {
  const settings = { selfAddress: 'pending', commandTimeoutMs: 5000, runnerStaleMs: 60_000, replayLimit: 100 };
  let onDisconnected!: () => void;
  const whenDisconnected = new Promise<void>((resolve) => { onDisconnected = resolve; });
  const module = createSessionModule({ db: db.db, settings, isAdmin: async () => false, runnerAuth: { verifyRunnerToken: async () => ({ ok: true, projectId: workspaceProject }) }, taskAccess: { canOpenStream: async () => true, onRunnerConnected: async () => {}, onRunnerDisconnected: async () => onDisconnected() } });
  const app = createApp({ name: 'invocation-session' });
  app.route('/', module.http.internal); app.route('/', module.http.runner);
  const server = Bun.serve({ port: 0, fetch: app.fetch, websocket: module.websocket, idleTimeout: 0 });
  settings.selfAddress = `http://127.0.0.1:${server.port}`;
  return { module, server, base: settings.selfAddress, whenDisconnected };
}

async function flowFixture(capable: boolean) {
  const db = await createTestDatabase([sessionMigrations, devSessionMigrations]);
  const cleanups: Array<() => Promise<unknown> | void> = [() => db.drop()];
  const dispose = async () => { for (const cleanup of cleanups.reverse()) await cleanup(); };
  try {
    const accepting = startSession(db), owning = startSession(db);
    cleanups.push(() => { accepting.server.stop(true); owning.server.stop(true); });
    const upstreamRequests: Array<{ path: string; body: string; method: string }> = [];
    const upstream = Bun.serve({ port: 0, fetch: async (request) => { upstreamRequests.push({ path: new URL(request.url).pathname, body: await request.text(), method: request.method }); return Response.json({ accepted: true }, { status: 201 }); } });
    cleanups.push(() => { upstream.stop(true); });
    const runner = await startTestRunner(`${owning.base.replace('http:', 'ws:')}/runner`, { internalApiBase: capable ? `http://127.0.0.1:${upstream.port}/api/` : undefined });
    cleanups.push(async () => { await runner.dispose(); await owning.whenDisconnected; });
    await runner.runner.whenConnected();
    const fixture = workspaceFixture();
    fixture.deps.runner = createSessionClient(accepting.base);
    fixture.deps.apiCatalog.listOperations = async () => [{ id: '01a0bf5d-8f4b-7b54-886c-7917f8da8165', proxyId: '01a0bf5d-8f4b-7048-89ae-74b8b9667da7', proxy: 'crm', method: 'POST', path: '/items/{id}', openPolicy: 'default', granted: true }];
    const dev = createDevSessionModule({ ...fixture.deps, db: db.db, isAdmin: async () => false });
    const app = createApp({ name: 'invocation-api' }); for (const route of dev.http) app.route('/', route);
    const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 }); cleanups.push(() => { server.stop(true); });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const client = createApiClient({ baseUrl, headers: { [IDENTITY_HEADERS.userId]: workspaceActor.userId } });
    return { client, fixture, upstreamRequests, dispose, baseUrl, accepting, owning };
  } catch (error) { await dispose(); throw error; }
}

const input = { expectedTaskId: workspaceTask, operationId: '01a0bf5d-8f4b-7b54-886c-7917f8da8165', pathParameters: { id: 'one two' }, query: {}, headers: { 'content-type': 'application/json' }, body: '{"name":"trial"}' };

test.skipIf(!available)('结构化客户端 → HTTP 授权 → 跨副本会话 → 真实 Runner → HTTP 回执；非法输入不触发调用', async () => {
  const f = await flowFixture(true);
  try {
    expect(await createSessionClient(f.accepting.base).connectionStatus(workspaceTask)).toMatchObject({ connected: true, replica: f.owning.base });
    expect(ApiInvocationResponseSchema.parse(await f.client.devSession.invokeApi(workspaceProject, input))).toMatchObject({ taskId: workspaceTask, operationId: input.operationId, result: { status: 201, body: '{"accepted":true}', truncated: false } });
    expect(f.upstreamRequests).toEqual([{ path: '/api/crm/items/one%20two', body: input.body, method: 'POST' }]);
    const headers = { [IDENTITY_HEADERS.userId]: workspaceActor.userId, 'content-type': 'application/json' };
    const path = `${f.baseUrl}/v1/projects/${workspaceProject}/dev-session/api-invocations`;
    const invalid = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ ...input, expectedTaskId: undefined }) });
    expect(invalid.status).toBe(400); expect(invalid.headers.get('cache-control')).toBe('no-store');
    expect((await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).status).toBe(401);
    f.fixture.deps.authorizer.authorize = async () => { throw forbidden(); };
    await expect(f.client.devSession.invokeApi(workspaceProject, input)).rejects.toMatchObject({ status: 403 });
    expect(f.upstreamRequests).toHaveLength(1);
  } finally { await f.dispose(); }
}, 15_000);

test.skipIf(!available)('不支持试调的容器跨副本返回明确拒绝，Runner 仍连接且 CLI 名册可读', async () => {
  const f = await flowFixture(false);
  try {
    await expect(f.client.devSession.invokeApi(workspaceProject, input)).rejects.toMatchObject({ status: 412, details: { code: 'api_invocations_unavailable' } });
    expect(f.upstreamRequests).toEqual([]);
    const session = createSessionClient(f.accepting.base);
    expect(await session.connectionStatus(workspaceTask)).toMatchObject({ connected: true });
    expect(await session.sendCommand(workspaceTask, { id: 'still-live', type: 'listAgentTerminals' })).toMatchObject({ terminals: [] });
  } finally { await f.dispose(); }
}, 15_000);
