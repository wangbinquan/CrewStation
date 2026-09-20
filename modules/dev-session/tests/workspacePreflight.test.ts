import { expect, test } from 'bun:test';
import { publishFromSessionUseCase } from '../application/publishFromSession';
import { sessionLifecycleUseCases } from '../application/sessionLifecycle';
import { workspaceStatusUseCase } from '../application/workspaceStatus';
import { checkedAt, readyWorkspace, workspaceActor, workspaceFixture, workspaceProject, workspaceTask } from './workspaceFixture';
import type { TaskId } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';

test('Git 检查失败不等同干净工作树，不推送也不创建标签', async () => {
  const { deps, state, commands } = workspaceFixture();
  state.execCode = 128;
  state.result = { status: 'unavailable', reason: 'fatal: not a git repository', checkedAt };
  // 原实现吞掉 git status 的非零退出码，把空 stdout 当干净，并继续发 push。
  await expect(publishFromSessionUseCase(deps)(workspaceActor, workspaceProject, { branch: 'main', version: 'patch' })).rejects.toMatchObject({ kind: 'precondition' });
  expect(commands.some((command) => command.type === 'exec' && command.command[0] === 'sh')).toBe(false);
  expect(state.published).toBe(false);
});

test('断线时仍保留负责人显式释放能力，但不返回已推送全部的空清单', async () => {
  const { deps, state } = workspaceFixture();
  state.connected = false;
  const result = await sessionLifecycleUseCases(deps).releaseSession(workspaceActor, workspaceProject, { force: true });
  // 原实现断线时回 []，CLI 和工作台会误报“没有未推送的提交”。
  expect(result.unpushed).toBeNull();
  expect(state.released).toBe(true);
});

test('预检是只读，保留当前 HEAD 而不是会话创建分支，并区分无会话', async () => {
  const { deps, state, commands } = workspaceFixture();
  state.result = { ...readyWorkspace(), branch: 'changed' };
  expect(await workspaceStatusUseCase(deps)(workspaceActor, workspaceProject)).toMatchObject({ status: 'ready', branch: 'changed', taskId: workspaceTask });
  expect(commands.map((command) => command.type)).toEqual(['workspaceStatus']);
  expect(state.released).toBe(false);
  state.missing = true;
  await expect(workspaceStatusUseCase(deps)(workspaceActor, workspaceProject)).rejects.toMatchObject({ kind: 'not_found' });
});

test('预检先授权；拒绝、旧 Runner 无效响应和传输失败均不能给出安全空清单', async () => {
  const { deps, state, commands } = workspaceFixture();
  deps.authorizer.authorize = async () => { throw forbidden('没有项目访问权限'); };
  await expect(workspaceStatusUseCase(deps)(workspaceActor, workspaceProject)).rejects.toMatchObject({ kind: 'forbidden' });
  expect(commands).toHaveLength(0);
  deps.authorizer.authorize = async () => {};
  state.result = {};
  expect(await workspaceStatusUseCase(deps)(workspaceActor, workspaceProject)).toMatchObject({ status: 'unavailable' });
  deps.runner.sendCommand = async () => { throw new Error('runner disconnected'); };
  expect(await workspaceStatusUseCase(deps)(workspaceActor, workspaceProject)).toMatchObject({ status: 'unavailable' });
});

test('发布重新读取实际工作树，dirty 或分支变化时不推送', async () => {
  const { deps, state, commands } = workspaceFixture();
  state.result = { ...readyWorkspace(), uncommittedCount: 1, uncommitted: [{ path: 'edited.txt', status: '.M', index: '.', worktree: 'M' }] };
  await expect(publishFromSessionUseCase(deps)(workspaceActor, workspaceProject, { branch: 'main', version: 'patch' })).rejects.toMatchObject({ kind: 'precondition', details: { uncommitted: ['edited.txt'] } });
  state.result = { ...readyWorkspace(), branch: 'changed' };
  await expect(publishFromSessionUseCase(deps)(workspaceActor, workspaceProject, { branch: 'main', version: 'patch' })).rejects.toMatchObject({ kind: 'precondition', details: { branch: 'changed' } });
  expect(commands.every((command) => command.type === 'workspaceStatus')).toBe(true);
});

test('确认对象已被替换时拒绝释放新会话', async () => {
  const { deps, state } = workspaceFixture();
  await expect(sessionLifecycleUseCases(deps).releaseSession(workspaceActor, workspaceProject, { expectedTaskId: '01a0bf5d-8f4b-7ad2-8eeb-8f56308fb856' as TaskId })).rejects.toMatchObject({ kind: 'precondition' });
  expect(state.released).toBe(false);
});
