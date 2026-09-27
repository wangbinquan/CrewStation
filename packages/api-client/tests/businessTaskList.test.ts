import { expect, test } from 'bun:test';
import { createApiClient } from '../index';

test('管理员任务列表保留分页和项目筛选，不改写为恢复操作', async () => {
  const calls: Array<{ url: string; method: string | undefined }> = [];
  const api = createApiClient({ baseUrl: 'https://cs.test', fetch: async (url, init) => { calls.push({ url: String(url), method: init?.method }); return Response.json({ items: [], next: 'next-cursor' }); } });
  expect(await api.tasks.listExecutionTasks({ projectId: 'project', cursor: 'cursor+/=', limit: 12 })).toEqual({ items: [], next: 'next-cursor' });
  expect(calls).toEqual([{ method: 'GET', url: 'https://cs.test/v1/admin/business-execution/tasks?projectId=project&cursor=cursor%2B%2F%3D&limit=12' }]);
  await api.tasks.listExecutionTasks(); expect(calls[1]?.url).toBe('https://cs.test/v1/admin/business-execution/tasks');
});
