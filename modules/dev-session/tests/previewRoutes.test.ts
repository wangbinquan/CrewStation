import { expect, test } from 'bun:test';
import { IDENTITY_HEADERS, PREVIEW_LOG_LIMITS } from '@crewstation/contracts';
import type { RunnerCommand } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { forbidden } from '@crewstation/kernel';
import type { DevSessionModuleApi } from '../api/moduleApi';
import { previewControlUseCases } from '../application/previewControl';
import { devSessionRoutes } from '../http/devSessionRoutes';
import { workspaceActor, workspaceFixture, workspaceProject, workspaceTask } from './workspaceFixture';

/** RFC-016：三条预览路由的 HTTP 面——查询串解析、动作枚举校验与授权到达。 */
function fixture(options: { allowed?: boolean } = {}) {
  const f = workspaceFixture(), asked: string[] = [], commands: RunnerCommand[] = [];
  const allowed = options.allowed ?? true;
  f.deps.authorizer.authorize = async (_actor, _projectId, action) => { asked.push(action); if (!allowed) throw forbidden('没有权限'); };
  f.deps.runner = {
    ...f.deps.runner,
    sendCommand: async (_taskId, command) => {
      commands.push(command);
      if (command.type === 'previewStatus') return { state: 'ready', port: 3000, restarts: 1 };
      if (command.type === 'previewLogs') return { lines: [], dropped: 0, attempt: 1 };
      return {};
    },
  };
  const api = previewControlUseCases(f.deps), app = createApp({ name: 'preview-routes-test' });
  app.route('/', devSessionRoutes(api as unknown as DevSessionModuleApi, async () => false));
  const send = (path: string, method = 'GET') => app.request(`/v1/projects/${workspaceProject}/dev-session/preview${path}`, {
    method, headers: { [IDENTITY_HEADERS.userId]: workspaceActor.userId },
  });
  return { ...f, asked, commands, send };
}

test('状态路由返回完整 DTO 且不缓存', async () => {
  const f = fixture(), response = await f.send('');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ taskId: workspaceTask, state: 'ready', port: 3000, restarts: 1, previewHost: 'dev.demo.cs.localhost', url: '//dev.demo.cs.localhost' });
  expect(f.asked).toEqual(['view']);
});

test('日志路由解析查询串，缺省取契约默认上限；越界与未知流向 400', async () => {
  const f = fixture();
  expect((await f.send('/logs')).status).toBe(200);
  expect(f.commands.at(-1)).toMatchObject({ type: 'previewLogs', limit: PREVIEW_LOG_LIMITS.defaultLimit });
  expect((await f.send('/logs?limit=25&stream=stderr')).status).toBe(200);
  expect(f.commands.at(-1)).toMatchObject({ type: 'previewLogs', limit: 25, stream: 'stderr' });
  for (const query of [`?limit=${PREVIEW_LOG_LIMITS.maxLines + 1}`, '?limit=0', '?stream=combined', '?unexpected=1']) {
    expect((await f.send(`/logs${query}`)).status, query).toBe(400);
  }
});

test('三个动作各自可达，非法动作被枚举挡住而不是当成未知路由', async () => {
  const f = fixture();
  for (const [action, type] of [['start', 'startPreview'], ['stop', 'stopPreview'], ['restart', 'restartPreview']] as const) {
    const response = await f.send(`/${action}`, 'POST');
    expect(response.status, action).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'ready' });
    expect(f.commands.map((command) => command.type)).toContain(type);
  }
  const bad = await f.send('/pause', 'POST');
  expect(bad.status).toBe(400);
  expect(JSON.stringify(await bad.json())).toContain('action');
});

test('读与控制分别落在 view 与 develop；无权限时不下发任何命令', async () => {
  const f = fixture({ allowed: false });
  expect((await f.send('')).status).toBe(403);
  expect((await f.send('/logs')).status).toBe(403);
  expect((await f.send('/restart', 'POST')).status).toBe(403);
  expect(f.asked).toEqual(['view', 'view', 'develop']);
  expect(f.commands).toEqual([]);
});
