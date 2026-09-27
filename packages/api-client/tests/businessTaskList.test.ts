import { expect, test } from 'bun:test';
import { createApiClient } from '../index';
import { RequestBusinessRecoverySchema } from '@crewstation/contracts';

test('管理员任务列表保留分页和项目筛选，不改写为恢复操作', async () => {
  const calls: Array<{ url: string; method: string | undefined }> = [];
  const api = createApiClient({ baseUrl: 'https://cs.test', fetch: async (url, init) => { calls.push({ url: String(url), method: init?.method }); return Response.json({ items: [], next: 'next-cursor' }); } });
  expect(await api.tasks.listExecutionTasks({ projectId: 'project', cursor: 'cursor+/=', limit: 12 })).toEqual({ items: [], next: 'next-cursor' });
  expect(calls).toEqual([{ method: 'GET', url: 'https://cs.test/v1/admin/business-execution/tasks?projectId=project&cursor=cursor%2B%2F%3D&limit=12' }]);
  await api.tasks.listExecutionTasks(); expect(calls[1]?.url).toBe('https://cs.test/v1/admin/business-execution/tasks');
  await api.tasks.listExecutionTasks({ state: 'failed' }); expect(calls[2]?.url).toBe('https://cs.test/v1/admin/business-execution/tasks?state=failed');
});

test('管理员恢复沿任务上下文评估、提交不可变目标并读取原请求，不接收应用fence', async () => {
  const calls: Array<{ url: string; method?: string; body: unknown }> = [];
  const api = createApiClient({ baseUrl: 'https://cs.test', fetch: async (url, init) => { calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined }); return Response.json({ items: [] }); } });
  const taskId = '01900000-0000-7000-8000-000000000001', childId = '01900000-0000-7000-8000-000000000002';
  const input = RequestBusinessRecoverySchema.parse({ requestKey: 'click-once', assessmentDigest: 'a'.repeat(64), target: { action: 'resume-task', taskId, expectedGeneration: 2, volumeUid: 'original-pvc', materialDigest: 'b'.repeat(64) } });
  await api.tasks.assessRecovery(taskId, childId); await api.tasks.requestRecovery(taskId, input); await api.tasks.listRecoveries(taskId); await api.tasks.assessRecovery(taskId);
  const root = `https://cs.test/v1/admin/business-execution/tasks/${taskId}/recovery`;
  expect(calls).toEqual([
    { url: `${root}?subtaskId=${childId}`, method: 'GET', body: undefined }, { url: root, method: 'POST', body: input },
    { url: root + '/requests', method: 'GET', body: undefined }, { url: root, method: 'GET', body: undefined },
  ]);
  await api.tasks.describeRecoveryTask('task/1'); expect(calls.at(-1)).toEqual({ url: 'https://cs.test/v1/admin/business-execution/tasks/task%2F1', method: 'GET', body: undefined });
});
