import { expect, test } from 'bun:test';
import { createFakeK8sClient } from './fakeClient';
import { createK8sClient } from './client';
import { Resources } from './resources';

test('重建前观察的 Pod 已被替换时，UID 前置条件不能删除新容器', async () => {
  const k8s = createFakeK8sClient();
  await k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'task-qa', namespace: 'cs-qa', uid: 'replacement' } });
  // 保卷恢复必须只删除刚确认的失败 Pod，不能凭相同名称删除另一实例。
  await expect(k8s.delete(Resources.Pod!, 'task-qa', 'cs-qa', { preconditions: { uid: 'original' } })).rejects.toMatchObject({ kind: 'conflict' });
  expect((await k8s.get(Resources.Pod!, 'task-qa', 'cs-qa'))?.metadata.uid).toBe('replacement');
  expect(await k8s.delete(Resources.Pod!, 'task-qa', 'cs-qa', { preconditions: { uid: 'replacement' } })).toBe(true);
  expect(await k8s.delete(Resources.Pod!, 'task-qa', 'cs-qa', { preconditions: { uid: 'replacement' } })).toBe(false);
});

test('真实客户端把 UID 和资源版本作为 DeleteOptions 前置条件传给 API Server', async () => {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const k8s = createK8sClient({ server: 'https://cluster.invalid', defaultNamespace: 'cs-qa' }, (async (url, init) => {
    requests.push({ method: init!.method!, path: new URL(String(url)).pathname, body: JSON.parse(String(init!.body)) });
    return Response.json({ status: 'Failure', code: 409, message: 'UID precondition failed' }, { status: 409 });
  }) as typeof fetch);
  await expect(k8s.delete(Resources.Pod!, 'task-qa', 'cs-qa', { gracePeriodSeconds: 30, preconditions: { uid: 'original', resourceVersion: '7' } })).rejects.toMatchObject({ kind: 'conflict' });
  expect(requests).toEqual([{ method: 'DELETE', path: '/api/v1/namespaces/cs-qa/pods/task-qa', body: { apiVersion: 'v1', kind: 'DeleteOptions', gracePeriodSeconds: 30, preconditions: { uid: 'original', resourceVersion: '7' } } }]);
});
