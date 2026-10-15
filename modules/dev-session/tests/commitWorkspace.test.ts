import { expect, test } from 'bun:test';
import { forbidden } from '@crewstation/kernel';
import { createApp } from '@crewstation/http';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { commitWorkspaceUseCase } from '../application/workspace/commitWorkspace';
import { devSessionRoutes } from '../http/devSessionRoutes';
import type { DevSessionModuleApi } from '../api/moduleApi';
import { workspaceActor, workspaceFixture, workspaceProject, workspaceSha, workspaceTask, readyWorkspace } from './workspaceFixture';

const input = { expectedTaskId: workspaceTask, expectedHead: workspaceSha, expectedBranch: 'main', expectedFingerprint: 'a'.repeat(64), message: 'Ready to build' };
test('权限先于工作区读取；只接受原任务并使用服务端身份提交', async () => {
  const f = workspaceFixture(); f.deps.authorizer.authorize = async () => { throw forbidden('denied'); };
  await expect(commitWorkspaceUseCase(f.deps)(workspaceActor, workspaceProject, input)).rejects.toMatchObject({ kind: 'forbidden' });
  expect(f.commands).toHaveLength(0);
  f.deps.authorizer.authorize = async (_actor, _project, action) => { expect(action).toBe('publish'); };
  f.state.connected = false;
  await expect(commitWorkspaceUseCase(f.deps)(workspaceActor, workspaceProject, input)).rejects.toMatchObject({ kind: 'precondition' });
  f.state.connected = true;
  await expect(commitWorkspaceUseCase(f.deps)(workspaceActor, workspaceProject, { ...input, expectedTaskId: workspaceProject as unknown as typeof workspaceTask })).rejects.toMatchObject({ kind: 'precondition' });
  expect(f.commands).toHaveLength(0);
  f.state.result = { commitSha: workspaceSha, branch: 'main', workspace: readyWorkspace() };
  expect(await commitWorkspaceUseCase(f.deps)(workspaceActor, workspaceProject, input)).toMatchObject({ taskId: workspaceTask });
  expect(f.commands).toMatchObject([{ type: 'commitWorkspace', actorUserId: workspaceActor.userId, expectedFingerprint: input.expectedFingerprint }]);
});

test('提交 HTTP 入口严格校验快照，不接受客户端伪造操作者', async () => {
  const f = workspaceFixture(); f.state.result = { commitSha: workspaceSha, branch: 'main', workspace: readyWorkspace() };
  const app = createApp({ name: 'workspace-commit-test' });
  app.route('/', devSessionRoutes({ commitWorkspace: commitWorkspaceUseCase(f.deps) } as DevSessionModuleApi, async () => false));
  const path = `/v1/projects/${workspaceProject}/dev-session/workspace-commits`, headers = { [IDENTITY_HEADERS.userId]: workspaceActor.userId, 'content-type': 'application/json' };
  const rejected = await app.request(path, { method: 'POST', headers, body: JSON.stringify({ ...input, actorUserId: workspaceProject }) });
  expect(rejected.status).toBe(400); expect(f.commands).toHaveLength(0);
  const response = await app.request(path, { method: 'POST', headers, body: JSON.stringify(input) });
  expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ taskId: workspaceTask, commitSha: workspaceSha });
  expect(f.commands).toMatchObject([{ actorUserId: workspaceActor.userId }]);
});
