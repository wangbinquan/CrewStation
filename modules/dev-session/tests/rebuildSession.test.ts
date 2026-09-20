import { expect, test } from 'bun:test';
import type { DevSessionModuleApi } from '../api/moduleApi';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { DevSessionRebuildInspection } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { forbidden } from '@crewstation/kernel';
import { sessionLifecycleUseCases, rebuildSessionUseCases } from '../application/sessionLifecycle';
import { devSessionRoutes } from '../http/devSessionRoutes';
import { checkedAt, workspaceActor, workspaceFixture, workspaceProject, workspaceTask } from './workspaceFixture';

function fixture() {
  const f = workspaceFixture(), calls: string[] = [], state = { allowed: true };
  const profile = { name: 'medium', cpu: '1', memory: '2Gi', storage: '10Gi' };
  const check: DevSessionRebuildInspection = { taskId: workspaceTask, projectId: workspaceProject, updatedAt: checkedAt, podUid: 'pod-original', volume: { uid: 'pvc-original', capacity: '10Gi' },
    currentProfile: profile.name, profiles: [{ ...profile, description: '' }], checkedAt };
  const input = { requestId: crypto.randomUUID(), expectedTaskId: workspaceTask, expectedUpdatedAt: checkedAt, expectedVolumeUid: 'pvc-original', expectedPodUid: 'pod-original', profile };
  f.deps.authorizer.authorize = async (_actor, projectId, action) => { calls.push(`${projectId}:${action}`); if (!state.allowed) throw forbidden('没有开发权限'); };
  f.deps.environments.inspectRebuild = async () => { calls.push('inspect'); return check; };
  f.deps.environments.requestRebuild = async (projectId, request) => { calls.push('submit'); expect(projectId).toBe(workspaceProject); expect(request).toEqual(input);
    return { requestId: request.requestId, taskId: workspaceTask, state: 'queued', profile, createdAt: checkedAt, updatedAt: checkedAt }; };
  const api = rebuildSessionUseCases(f.deps), app = createApp({ name: 'rebuild-test' });
  app.route('/', devSessionRoutes(api as DevSessionModuleApi, async () => false));
  const send = (method: string, body?: object) => app.request(`/v1/projects/${workspaceProject}/dev-session/rebuild`, { method,
    headers: { [IDENTITY_HEADERS.userId]: workspaceActor.userId, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { ...f, calls, state, input, check, send };
}

test('恢复检查与受理均要求 develop；无权限时不查询卷或提交运行时任务', async () => {
  const f = fixture(); f.state.allowed = false;
  expect((await f.send('GET')).status).toBe(403); expect((await f.send('POST', f.input)).status).toBe(403);
  expect(f.calls).toEqual([`${workspaceProject}:develop`, `${workspaceProject}:develop`]);
});

test('恢复 HTTP 返回实际检查、202 排队回执；拒绝缺少任务／卷确认和额外字段', async () => {
  const f = fixture(), check = await f.send('GET');
  expect(check.status).toBe(200); expect(check.headers.get('cache-control')).toBe('no-store'); expect(await check.json()).toEqual(f.check);
  const receipt = await f.send('POST', f.input); expect(receipt.status).toBe(202); expect(await receipt.json()).toMatchObject({ requestId: f.input.requestId, state: 'queued', taskId: workspaceTask });
  for (const key of ['expectedTaskId', 'expectedVolumeUid', 'expectedPodUid', 'requestId']) {
    const body = { ...f.input }; Reflect.deleteProperty(body, key); expect((await f.send('POST', body)).status).toBe(400);
  }
  expect((await f.send('POST', { ...f.input, deleteVolume: true })).status).toBe(400);
  expect(f.calls.filter((call) => call === 'submit')).toHaveLength(1);
});


test('会话读取投影结构化协议故障，不向未连接的容器发送预览命令', async () => {
  const f = workspaceFixture(); f.state.connected = false;
  const original = f.deps.environments.findDevSession;
  const issue = { code: 'protocol_mismatch' as const, runnerProtocol: 1, requiredProtocol: 2, message: '旧协议不兼容', at: checkedAt };
  f.deps.environments.findDevSession = async (...args) => ({ ...(await original(...args))!, connectionIssue: issue });
  expect(await sessionLifecycleUseCases(f.deps).getSession(workspaceActor, workspaceProject)).toMatchObject({ taskId: workspaceTask, preview: 'stopped', connectionIssue: issue });
  expect(f.commands).toEqual([]);
});
