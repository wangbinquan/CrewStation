// RFC-034 v2：项目与系统两级运行统计共用同一组查询，项目路径只多一段 projectId；价格与费用可见性仅系统。
import { expect, test } from 'bun:test';
import { createApiClient, type FetchLike } from '../index';

function recorder() {
  const calls: Array<{ method: string; path: string; query: Record<string, string>; body: unknown }> = [];
  const fetch: FetchLike = async (raw, init) => {
    const url = new URL(String(raw), 'http://client.test');
    calls.push({ method: init?.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({});
  };
  return { calls, api: createApiClient({ fetch }).observability };
}

test('project and system statistics share one query surface; the project path only adds the project segment', async () => {
  const { calls, api } = recorder();
  const window = { from: '2026-10-07T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z', tzOffset: 480 };
  await api.overview('project /one', window);
  await api.overview(undefined, window);
  await api.tasks('project /one', { ...window, q: '修复', source: 'business', cursor: 'next' });
  await api.task(undefined, 'task /one');
  await api.agents('project /one', window);
  await api.models(undefined, window);
  await api.projects(window);
  await api.platform({ ...window, cursor: 'c' });
  expect(calls.map((call) => call.path)).toEqual([
    '/v1/projects/project%20%2Fone/observability/overview', '/v1/admin/observability/overview',
    '/v1/projects/project%20%2Fone/observability/tasks', '/v1/admin/observability/tasks/task%20%2Fone',
    '/v1/projects/project%20%2Fone/observability/agents', '/v1/admin/observability/models',
    '/v1/admin/observability/projects', '/v1/admin/observability/platform',
  ]);
  expect(calls[0]!.query).toEqual({ from: window.from, to: window.to, tzOffset: '480' });
  expect(calls[2]!.query).toMatchObject({ q: '修复', source: 'business', cursor: 'next' });
});

test('prices and project cost visibility are system writes with their own paths', async () => {
  const { calls, api } = recorder();
  await api.pricing();
  await api.priceHistory('profile /one', 'zhipu/glm-5');
  const price = { model: 'zhipu/glm-5', rates: { input: '2', cacheRead: '0.5', cacheWrite: null, output: '8' }, effectiveFrom: '2026-10-14T00:00:00.000Z', expectedLatestId: null };
  await api.savePrice('profile /one', price);
  await api.costVisibility('project /one');
  await api.setCostVisibility('project /one', { visible: true });
  expect(calls.map((call) => [call.method, call.path])).toEqual([
    ['GET', '/v1/admin/observability/pricing'],
    ['GET', '/v1/admin/observability/pricing/profile%20%2Fone/history'],
    ['POST', '/v1/admin/observability/pricing/profile%20%2Fone'],
    ['GET', '/v1/admin/observability/projects/project%20%2Fone/cost-visibility'],
    ['PUT', '/v1/admin/observability/projects/project%20%2Fone/cost-visibility'],
  ]);
  expect(calls[1]!.query).toEqual({ model: 'zhipu/glm-5' });
  expect(calls[2]!.body).toEqual(price);
  expect(calls[4]!.body).toEqual({ visible: true });
});
