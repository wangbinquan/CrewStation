import { expect, test } from 'bun:test';
import type { RunnerCommand } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import { previewControlUseCases } from '../application/previewControl';
import { workspaceActor, workspaceFixture, workspaceProject, workspaceTask } from './workspaceFixture';

type Payloads = { status?: unknown; logs?: unknown };

/** RFC-016：用例只负责授权、映射与失败分支；预览进程本身的行为由 runtimes/task 的用例覆盖。 */
function fixture(options: { allow?: ReadonlyArray<'view' | 'develop'>; payloads?: Payloads } = {}) {
  const f = workspaceFixture();
  const allow = options.allow ?? ['view', 'develop'];
  const asked: string[] = [];
  const commands: RunnerCommand[] = [];
  const touched: string[] = [];
  const status = options.payloads?.status ?? { state: 'ready', port: 3000, restarts: 2, lastError: 'exited with code 1' };
  f.deps.authorizer = {
    authorize: async (_actor, _projectId, action) => {
      asked.push(action);
      if (!allow.includes(action as 'view' | 'develop')) throw forbidden(`不允许 ${action}`);
    },
    ownerOf: async () => workspaceActor.userId,
  };
  f.deps.environments = { ...f.deps.environments, touch: async (taskId) => { touched.push(taskId); } };
  f.deps.runner = {
    ...f.deps.runner,
    sendCommand: async (_taskId, command) => {
      commands.push(command);
      if (command.type === 'previewStatus') return status;
      if (command.type === 'previewLogs') return options.payloads?.logs ?? { lines: [], dropped: 0, attempt: 1 };
      return {};
    },
  };
  return { ...f, asked, commands, touched, api: previewControlUseCases(f.deps) };
}

test('状态把 Runner 的全部字段带出来，地址只在就绪时给出', async () => {
  const f = fixture();
  expect(await f.api.previewStatus(workspaceActor, workspaceProject)).toEqual({
    taskId: workspaceTask, state: 'ready', port: 3000, restarts: 2, lastError: 'exited with code 1',
    previewHost: 'dev.demo.cs.localhost', url: '//dev.demo.cs.localhost',
  });
  expect(f.asked).toEqual(['view']);

  const crashed = fixture({ payloads: { status: { state: 'crashed', port: 3000, restarts: 5, lastError: 'exited with code 7' } } });
  const dto = await crashed.api.previewStatus(workspaceActor, workspaceProject);
  // 这两项此前在 sessionLifecycle 被丢掉，Agent 只能看到一个光秃秃的 crashed。
  expect(dto).toMatchObject({ state: 'crashed', restarts: 5, lastError: 'exited with code 7' });
  expect(dto.url).toBeUndefined();
});

test('没有可选字段时不补造默认值', async () => {
  const f = fixture({ payloads: { status: { state: 'disabled', restarts: 0 } } });
  const dto = await f.api.previewStatus(workspaceActor, workspaceProject);
  expect(dto).toEqual({ taskId: workspaceTask, state: 'disabled', restarts: 0, previewHost: 'dev.demo.cs.localhost' });
  expect(dto.port).toBeUndefined();
  expect(dto.lastError).toBeUndefined();
});

test('三个动作各自发对命令、刷新活动时间并回读状态', async () => {
  for (const [action, type] of [['start', 'startPreview'], ['stop', 'stopPreview'], ['restart', 'restartPreview']] as const) {
    const f = fixture();
    expect(await f.api.controlPreview(workspaceActor, workspaceProject, action)).toMatchObject({ state: 'ready' });
    expect(f.commands.map((command) => command.type)).toEqual([type, 'previewStatus']);
    expect(f.touched).toEqual([workspaceTask]);
    expect(f.asked).toEqual(['develop']);
  }
});

test('读用 view、控制用 develop：只读成员改不动预览', async () => {
  const readOnly = fixture({ allow: ['view'] });
  await expect(readOnly.api.controlPreview(workspaceActor, workspaceProject, 'stop')).rejects.toMatchObject({ kind: 'forbidden' });
  expect(readOnly.commands).toEqual([]);
  expect(await readOnly.api.previewStatus(workspaceActor, workspaceProject)).toMatchObject({ state: 'ready' });

  const outsider = fixture({ allow: [] });
  await expect(outsider.api.previewStatus(workspaceActor, workspaceProject)).rejects.toMatchObject({ kind: 'forbidden' });
  await expect(outsider.api.previewLogs(workspaceActor, workspaceProject, { limit: 10 })).rejects.toMatchObject({ kind: 'forbidden' });
  expect(outsider.commands).toEqual([]);
});

test('日志按入参传给 Runner，结果带上任务标识', async () => {
  const lines = [{ at: '2026-09-21T00:00:00.000Z', stream: 'stderr' as const, attempt: 2, text: 'boom' }];
  const f = fixture({ payloads: { logs: { lines, dropped: 7, attempt: 2 } } });
  expect(await f.api.previewLogs(workspaceActor, workspaceProject, { limit: 25, stream: 'stderr' }))
    .toEqual({ taskId: workspaceTask, lines, dropped: 7, attempt: 2 });
  expect(f.commands[0]).toEqual({ id: expect.any(String), type: 'previewLogs', limit: 25, stream: 'stderr' });

  const noStream = fixture();
  await noStream.api.previewLogs(workspaceActor, workspaceProject, { limit: 10 });
  expect(noStream.commands[0]).toEqual({ id: expect.any(String), type: 'previewLogs', limit: 10 });
});

test('没有会话报 not_found；容器断线报 precondition 而不是伪装成已停止', async () => {
  const missing = fixture();
  missing.state.missing = true;
  await expect(missing.api.previewStatus(workspaceActor, workspaceProject)).rejects.toMatchObject({ kind: 'not_found' });

  const offline = fixture();
  offline.state.connected = false;
  // 逐个惰性构造：一次性建好三个 promise 会在断言接手前就抛成未处理拒绝。
  for (const call of [
    () => offline.api.previewStatus(workspaceActor, workspaceProject),
    () => offline.api.previewLogs(workspaceActor, workspaceProject, { limit: 10 }),
    () => offline.api.controlPreview(workspaceActor, workspaceProject, 'restart'),
  ]) {
    await expect(call()).rejects.toMatchObject({ kind: 'precondition' });
  }
  expect(offline.commands).toEqual([]);
});
