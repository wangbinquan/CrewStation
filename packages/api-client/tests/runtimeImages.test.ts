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

test('新增完整配方与历史查询保留请求键、项目版本及分页位置', async () => {
  const calls: Array<{ method?: string; url: string; body?: unknown }> = [];
  const api = createApiClient({ baseUrl: 'https://cs.test', fetch: async (url, init) => { calls.push({ method: init?.method, url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined }); return Response.json({ items: [] }); } });
  const input = { name: 'Tools', description: '', requestKey: 'same-create', recipe: { source: { kind: 'existing' as const, reference: 'runtime/tools:1', usage: 'task' as const, architecture: 'linux/amd64' as const }, initializer: { steps: [], env: {}, secrets: [] }, tools: [] } };
  await api.runtimeImages.createSetup('p/a', input);
  await api.runtimeImages.history('p/a', 'image', { versionId: 'version', before: 'cursor', limit: 20 });
  expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://cs.test/v1/projects/p%2Fa/runtime-images/setup', body: input });
  const query = new URL(calls[1]!.url); expect(query.pathname).toBe('/v1/projects/p%2Fa/runtime-images/image/history'); expect(Object.fromEntries(query.searchParams)).toEqual({ versionId: 'version', before: 'cursor', limit: '20' });
});

test('业务镜像授权使用独立配置路径，保留空允许集合与预期修订', async () => {
  const calls: Array<{ method?: string; url: string; body?: unknown }> = [];
  const api = createApiClient({ baseUrl: 'https://cs.test', fetch: async (url, init) => {
    calls.push({ method: init?.method, url: String(url), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) }); return Response.json({ revision: 4 });
  } });
  await api.runtimeImages.projectPolicy('p/a');
  const input = { expectedRevision: 3, policy: { mode: 'restricted' as const, allowedImageIds: [] } };
  await api.runtimeImages.saveProjectPolicy('p/a', input);
  expect(calls).toEqual([
    { method: 'GET', url: 'https://cs.test/v1/projects/p%2Fa/runtime-image-policy' },
    { method: 'PUT', url: 'https://cs.test/v1/projects/p%2Fa/runtime-image-policy', body: input },
  ]);
});

test('平台管理不拼入 undefined 项目，验证消费业务仅在请求正文中传递', async () => {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const api = createApiClient({ baseUrl: 'https://cs.test', fetch: async (url, init) => { calls.push({ url: String(url), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) }); return Response.json({}); } });
  await api.runtimeImages.create(undefined, { name: 'Global', description: '', defaultVisible: true });
  await api.runtimeImages.logs(undefined, 'i/a', 'b', 4);
  await api.runtimeImages.grants('i/a');
  await api.runtimeImages.adminVersion('i/a', 'v');
  await api.runtimeImages.validate(undefined, 'i/a', 'v', { projectId: 'consumer', requestKey: 'validation', target: { usage: 'task' } });
  expect(calls.map((call) => call.url)).toEqual([
    'https://cs.test/v1/admin/runtime-image-catalog', 'https://cs.test/v1/admin/runtime-image-catalog/i%2Fa/builds/b/logs?after=4',
    'https://cs.test/v1/admin/runtime-image-catalog/i%2Fa/grants', 'https://cs.test/v1/admin/runtime-image-catalog/i%2Fa/versions/v', 'https://cs.test/v1/admin/runtime-image-catalog/i%2Fa/versions/v/validations',
  ]);
  expect(calls.at(-1)?.body).toEqual({ projectId: 'consumer', requestKey: 'validation', target: { usage: 'task' } });
});
