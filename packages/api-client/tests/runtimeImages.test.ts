import { expect, test } from 'bun:test';
import { createApiClient } from '../index';

test('显式开发镜像只发严格 v2，不降级；无选择仍兼容原入口', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const api = createApiClient({ baseUrl: 'https://cs.test', fetch: async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ error: 'not_found', message: 'old platform' }, { status: 404 });
  } });
  for (const image of [undefined, 'image-version']) {
    const selected = image ? { runtimeImageVersionId: image } : {};
    await expect(api.devSession.open('project', { branch: 'main', ...selected })).rejects.toMatchObject({ status: 404 });
    await expect(api.devSession.startAgent('task', { prompt: 'hello', ...selected })).rejects.toMatchObject({ status: 404 });
    await expect(api.devSession.startNativeTerminal('task', { clientRequestId: crypto.randomUUID(), cols: 80, rows: 24, ...selected })).rejects.toMatchObject({ status: 404 });
  }
  expect(requests).toHaveLength(6);
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
    '/v1/projects/project/dev-session', '/v1/tasks/task/agents', '/v1/tasks/task/agent-terminals',
    '/v2/projects/project/dev-session', '/v2/tasks/task/agents', '/v2/tasks/task/agent-terminals',
  ]);
  for (const request of requests.slice(3)) expect(request.body).toMatchObject({ runtimeImageVersionId: 'image-version' });
});

test('运行镜像客户端保留日志游标、请求键和配置版本，管理员目录使用独立路径', async () => {
  const calls: Array<{ method?: string; url: string; body?: unknown }> = [];
  const api = createApiClient({ baseUrl: 'https://cs.test', fetch: async (url, init) => {
    calls.push({ method: init?.method, url: String(url), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) }); return Response.json({ items: [] });
  } });
  await api.runtimeImages.logs('p/a', 'i', 'b', 12);
  await api.runtimeImages.cancelBuild('p', 'i', 'b', 'cancel-key');
  await api.runtimeImages.saveDevelopment('p', { expectedRevision: 3, developmentTask: {}, developmentAgents: [] });
  await api.runtimeImages.adminCatalog({ limit: 30 });
  expect(calls[0]?.url).toBe('https://cs.test/v1/projects/p%2Fa/runtime-images/i/builds/b/logs?after=12');
  expect(calls[1]).toMatchObject({ method: 'POST', body: { requestKey: 'cancel-key' } });
  expect(calls[2]).toMatchObject({ method: 'PUT', body: { expectedRevision: 3 } });
  expect(calls[3]?.url).toBe('https://cs.test/v1/admin/runtime-image-catalog?limit=30');
});
