import { describe, expect, test } from 'bun:test';
import { IDENTITY_HEADERS, PREVIEW_LOG_LIMITS } from '@crewstation/contracts';
import type { McpToolDefinition, OperationsContext } from '../index';
import { createMcpApp, operationsContextFor, operationsServerDefinition } from '../index';
import type { CapturedRequest } from './fakePlatform';
import {
  CALLER_IDENTITY, INITIALIZE, PROJECT_ID, SERVICE_ID, callerHeaders, fakePlatform, firstText, isErrorResult, jsonResponse, operation, projectPage, rpc,
} from './fakePlatform';

const PLATFORM = 'http://api.svc.cs.internal';
const INTERNAL = 'http://api.svc.cs.internal/api/';
const TASK_ID = '01a0bf5d-8f4b-75cd-8578-3f54c85da51e';

const DEFINITION = operationsServerDefinition('0.1.0');
const toolNamed = (name: string): McpToolDefinition<OperationsContext> => {
  const hit = DEFINITION.tools.find((tool) => tool.name === name);
  if (!hit) throw new Error(`没有工具 ${name}`);
  return hit;
};

function route(request: CapturedRequest): Response {
  const path = request.url.startsWith(PLATFORM) ? request.url.slice(PLATFORM.length) : request.url;
  if (path === '/v1/projects') return jsonResponse(200, projectPage());
  if (path === `/v1/projects/${PROJECT_ID}/publish`) return jsonResponse(202, { id: '01a0bf5d-8f4b-7033-8d68-9e5bbb2ec163', tag: 'v0.1.1', status: 'building' });
  if (path === `/v1/projects/${PROJECT_ID}/branches`) return jsonResponse(200, { items: [{ name: 'main', headSha: 'abc1234', isDefault: true, behindPreview: 0, behindProd: 2 }] });
  if (path === `/v1/projects/${PROJECT_ID}/dev-session`) return jsonResponse(200, { state: 'running', branch: 'main', previewHost: 'dev.demo.cs.localhost', preview: 'ready' });
  if (path === `/v1/projects/${PROJECT_ID}/dev-session/preview`) return jsonResponse(200, { taskId: TASK_ID, state: 'crashed', port: 3000, restarts: 5, lastError: 'exited with code 7', previewHost: 'dev.demo.cs.localhost' });
  if (path.startsWith(`/v1/projects/${PROJECT_ID}/dev-session/preview/logs`)) return jsonResponse(200, { taskId: TASK_ID, lines: [{ at: '2026-09-21T00:00:00.000Z', stream: 'stderr', attempt: 2, text: 'boom' }], dropped: 4, attempt: 2 });
  for (const action of ['start', 'stop', 'restart']) {
    if (path === `/v1/projects/${PROJECT_ID}/dev-session/preview/${action}`) return jsonResponse(200, { taskId: TASK_ID, state: action === 'stop' ? 'stopped' : 'starting', port: 3000, restarts: 0, previewHost: 'dev.demo.cs.localhost' });
  }
  if (path === `/v1/services/${SERVICE_ID}/slots`) return jsonResponse(200, { items: [{ name: 'preview', active: false, state: 'ready' }, { name: 'prod', active: true, state: 'ready' }] });
  if (path.startsWith(`/v1/projects/${PROJECT_ID}/logs`)) return jsonResponse(200, { items: [{ ts: '2026-09-11T00:00:00.000Z', source: 'slot', stream: 'stdout', message: 'hello' }] });
  if (path.startsWith('/v1/catalog/operations')) return jsonResponse(200, { items: [operation('gitlab', '/projects', true), operation('crm', '/customers', false)] });
  if (request.url.startsWith(INTERNAL)) return jsonResponse(200, { ok: true, seen: request.url });
  return jsonResponse(404, { error: 'not_found', message: `没有路由 ${request.url}`, details: {} });
}

function appFor(handler: (request: CapturedRequest) => Response = route) {
  const platform = fakePlatform(handler);
  const app = createMcpApp({
    name: 'mcp-operations',
    path: '/mcp',
    definition: DEFINITION,
    contextFor: (request) => operationsContextFor({ platformApiUrl: PLATFORM, internalApiBase: INTERNAL, fetch: platform.fetchImpl }, request),
  });
  return { app, platform };
}

let nextId = 100;
const call = (app: ReturnType<typeof appFor>['app'], name: string, args: unknown, headers = callerHeaders()) =>
  rpc(app, { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }, { headers });

describe('操作 MCP：工具目录', () => {
  test('暴露八个工具，名字与顺序固定', () => {
    expect(DEFINITION.tools.map((tool) => tool.name)).toEqual([
      'publish_release', 'list_branches', 'list_internal_apis', 'call_internal_api',
      'read_preview_status', 'control_preview', 'read_preview_logs', 'tail_logs',
    ]);
    expect(DEFINITION.resources).toHaveLength(0);
  });

  test('预览三工具都说清与部署槽的区别，控制与日志还写明改 Manifest 要重建会话', () => {
    for (const name of ['read_preview_status', 'control_preview', 'read_preview_logs']) {
      expect(toolNamed(name).description, name).toContain('部署槽');
    }
    expect(toolNamed('control_preview').description).toContain('重建开发会话');
  });

  test('每个工具都有能照着做的描述', () => {
    for (const tool of DEFINITION.tools) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  test('instructions 说明会话释放后一律拒绝，且只声明 tools 能力', async () => {
    const { app } = appFor();
    const { payload } = await rpc(app, INITIALIZE, { headers: callerHeaders() });
    const result = payload.result as { instructions: string; capabilities: Record<string, unknown> };
    expect(result.instructions).toContain('会话释放后');
    expect(Object.keys(result.capabilities)).toEqual(['tools']);
  });
});

describe('操作 MCP：入参校验', () => {
  test('publish_release 必须给分支，版本只收完整号或递增级别', () => {
    const tool = toolNamed('publish_release');
    expect(tool.checkInput({}).ok).toBe(false);
    expect(tool.checkInput({ branch: 'main' })).toEqual({ ok: true, value: { branch: 'main' } });
    expect(tool.checkInput({ branch: 'main', version: 'v1.2.3' }).ok).toBe(true);
    expect(tool.checkInput({ branch: 'main', version: 'minor' }).ok).toBe(true);
    expect(tool.checkInput({ branch: 'main', version: '1.2.3' }).ok).toBe(false);
    expect(tool.checkInput({ branch: 'main', message: 'x'.repeat(501) }).ok).toBe(false);
  });

  test('list_branches 与 read_preview_status 不收参数', () => {
    for (const name of ['list_branches', 'read_preview_status']) {
      expect(toolNamed(name).checkInput({}).ok).toBe(true);
      expect(toolNamed(name).checkInput(undefined).ok).toBe(true);
    }
  });

  test('control_preview 的动作是枚举；read_preview_logs 的上限与流向有界', () => {
    const control = toolNamed('control_preview');
    expect(control.checkInput({}).ok).toBe(false);
    expect(control.checkInput({ action: 'stop' })).toEqual({ ok: true, value: { action: 'stop' } });
    expect(control.checkInput({ action: 'kill' }).ok).toBe(false);
    const logs = toolNamed('read_preview_logs');
    expect(logs.checkInput({}).ok).toBe(true);
    expect(logs.checkInput({ limit: 0 }).ok).toBe(false);
    expect(logs.checkInput({ limit: PREVIEW_LOG_LIMITS.maxLines }).ok).toBe(true);
    expect(logs.checkInput({ limit: PREVIEW_LOG_LIMITS.maxLines + 1 }).ok).toBe(false);
    expect(logs.checkInput({ stream: 'combined' }).ok).toBe(false);
  });

  test('list_internal_apis 的 proxy 可选', () => {
    const tool = toolNamed('list_internal_apis');
    expect(tool.checkInput({}).ok).toBe(true);
    expect(tool.checkInput({ proxy: 'gitlab' }).ok).toBe(true);
    expect(tool.checkInput({ proxy: 7 }).ok).toBe(false);
  });

  test('call_internal_api 必须给代理、方法与路径，方法限于目录登记的五种', () => {
    const tool = toolNamed('call_internal_api');
    expect(tool.checkInput({ proxy: 'gitlab', method: 'GET' }).ok).toBe(false);
    expect(tool.checkInput({ proxy: 'gitlab', method: 'get', path: '/x' }).ok).toBe(false);
    expect(tool.checkInput({ proxy: 'gitlab', method: 'OPTIONS', path: '/x' }).ok).toBe(false);
    expect(tool.checkInput({ proxy: 'gitlab', method: 'POST', path: '/x', body: '{}' }).ok).toBe(true);
  });

  test('tail_logs 的来源是枚举，taskId 必须是平台 ID，limit 有上限', () => {
    const tool = toolNamed('tail_logs');
    expect(tool.checkInput({ source: 'slot' }).ok).toBe(true);
    expect(tool.checkInput({ source: '别的' }).ok).toBe(false);
    expect(tool.checkInput({ source: 'slot', slot: 'staging' }).ok).toBe(false);
    expect(tool.checkInput({ source: 'dev-session', taskId: 'tsk_1' }).ok).toBe(false);
    expect(tool.checkInput({ source: 'dev-session', taskId: '01a0bf5d-8f4b-75cd-8578-3f54c85da51e' }).ok).toBe(true);
    expect(tool.checkInput({ source: 'slot', limit: 5000 }).ok).toBe(false);
    expect(tool.checkInput({ source: 'slot', since: '昨天' }).ok).toBe(false);
  });

  test('校验失败的文本指出是哪个字段', () => {
    const result = toolNamed('publish_release').checkInput({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('branch');
  });
});

describe('操作 MCP：调用路径', () => {
  test('publish_release 打到开发会话的发布路由，身份透传', async () => {
    const { app, platform } = appFor();
    const { payload } = await call(app, 'publish_release', { branch: 'feat/x', version: 'minor', message: '加一个页面' });
    expect(isErrorResult(payload)).toBe(false);
    const publish = platform.calls.find((c) => c.url.endsWith('/publish'));
    expect(publish?.method).toBe('POST');
    expect(JSON.parse(publish?.body ?? '{}')).toEqual({ branch: 'feat/x', version: 'minor', message: '加一个页面' });
    expect(publish?.headers.get(IDENTITY_HEADERS.sourceService)).toBe(CALLER_IDENTITY);
  });

  test('未给的可选参数不会作为 undefined 出现在请求体里', async () => {
    const { app, platform } = appFor();
    await call(app, 'publish_release', { branch: 'main' });
    expect(JSON.parse(platform.calls.find((c) => c.url.endsWith('/publish'))?.body ?? '{}')).toEqual({ branch: 'main' });
  });

  test('list_branches 返回落后两槽的提交数', async () => {
    const { app } = appFor();
    const { payload } = await call(app, 'list_branches', {});
    expect(JSON.parse(firstText(payload))).toEqual([{ name: 'main', headSha: 'abc1234', isDefault: true, behindPreview: 0, behindProd: 2 }]);
  });

  test('list_internal_apis 按本服务查目录，可按代理名过滤', async () => {
    const { app, platform } = appFor();
    const all = await call(app, 'list_internal_apis', {});
    expect(JSON.parse(firstText(all.payload))).toHaveLength(2);
    expect(platform.calls.some((c) => c.url.includes(`serviceId=${SERVICE_ID}`))).toBe(true);
    const filtered = await call(app, 'list_internal_apis', { proxy: 'crm' });
    expect(JSON.parse(firstText(filtered.payload))).toEqual([operation('crm', '/customers', false)]);
  });

  test('call_internal_api 拼到服务域的内部 API 前缀并透传身份', async () => {
    const { app, platform } = appFor();
    const { payload } = await call(app, 'call_internal_api', { proxy: 'gitlab', method: 'POST', path: '/projects/1/issues', body: '{"title":"x"}' });
    const outbound = platform.calls.find((c) => c.url.startsWith(INTERNAL));
    expect(outbound?.url).toBe(`${INTERNAL}gitlab/projects/1/issues`);
    expect(outbound?.method).toBe('POST');
    expect(outbound?.headers.get(IDENTITY_HEADERS.sourceService)).toBe(CALLER_IDENTITY);
    expect(outbound?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(firstText(payload)).status).toBe(200);
  });

  test('开发会话令牌原样转给 cs-api，但不跟着内部 API 出到公司上游', async () => {
    const { app, platform } = appFor();
    const headers = { ...callerHeaders(), [IDENTITY_HEADERS.devSessionToken]: 'session-token' };
    await call(app, 'call_internal_api', { proxy: 'gitlab', method: 'GET', path: '/projects' }, headers);
    await call(app, 'list_branches', {}, headers);
    const platformCall = platform.calls.find((c) => c.url.endsWith('/branches'));
    expect(platformCall?.headers.get(IDENTITY_HEADERS.devSessionToken)).toBe('session-token');
    const outbound = platform.calls.find((c) => c.url.startsWith(INTERNAL));
    expect(outbound?.headers.get(IDENTITY_HEADERS.devSessionToken)).toBeNull();
  });

  test('内部 API 未放行时把网关的状态与正文交给 Agent', async () => {
    const { app } = appFor((request) =>
      request.url.startsWith(INTERNAL)
        ? jsonResponse(403, { error: 'forbidden', message: '放行表未允许 demo/worker 调用 GET /api/crm/customers', details: {} })
        : route(request));
    const { payload } = await call(app, 'call_internal_api', { proxy: 'crm', method: 'GET', path: '/customers' });
    expect(isErrorResult(payload)).toBe(true);
    expect(firstText(payload)).toContain('HTTP 403');
    expect(firstText(payload)).toContain('放行表未允许');
  });

  test('read_preview_status 给出崩溃原因与重启次数，外加两个槽', async () => {
    const { app } = appFor();
    const { payload } = await call(app, 'read_preview_status', {});
    const value = JSON.parse(firstText(payload)) as { devSession: { branch: string }; preview: Record<string, unknown>; slots: Array<{ name: string }> };
    // 这两项是 RFC-016 的要点：此前 Agent 只能看到一个光秃秃的 crashed。
    expect(value.preview).toMatchObject({ state: 'crashed', restarts: 5, lastError: 'exited with code 7', port: 3000 });
    expect(value.devSession.branch).toBe('main');
    expect(value.slots.map((slot) => slot.name)).toEqual(['preview', 'prod']);
  });

  test('control_preview 三个动作各打各的路由，返回动作后的状态', async () => {
    for (const [action, state] of [['start', 'starting'], ['stop', 'stopped'], ['restart', 'starting']] as const) {
      const { app, platform } = appFor();
      const { payload } = await call(app, 'control_preview', { action });
      expect(JSON.parse(firstText(payload))).toMatchObject({ state });
      const sent = platform.calls.find((c) => c.url.includes('/dev-session/preview/'));
      expect(sent?.url).toBe(`${PLATFORM}/v1/projects/${PROJECT_ID}/dev-session/preview/${action}`);
      expect(sent?.method).toBe('POST');
      expect(sent?.headers.get(IDENTITY_HEADERS.sourceService)).toBe(CALLER_IDENTITY);
    }
  });

  test('read_preview_logs 把上限与流向带进查询串，dropped 原样透出', async () => {
    const { app, platform } = appFor();
    const { payload } = await call(app, 'read_preview_logs', { limit: 25, stream: 'stderr' });
    const value = JSON.parse(firstText(payload)) as { lines: Array<{ attempt: number; text: string }>; dropped: number };
    expect(value.lines[0]).toMatchObject({ attempt: 2, text: 'boom' });
    expect(value.dropped).toBe(4);
    const sent = platform.calls.find((c) => c.url.includes('/preview/logs'));
    expect(sent?.url).toContain('limit=25');
    expect(sent?.url).toContain('stream=stderr');
  });

  test('read_preview_logs 不给参数时不往查询串塞空值', async () => {
    const { app, platform } = appFor();
    await call(app, 'read_preview_logs', {});
    const sent = platform.calls.find((c) => c.url.includes('/preview/logs'));
    expect(sent?.url).toBe(`${PLATFORM}/v1/projects/${PROJECT_ID}/dev-session/preview/logs`);
  });

  test('tail_logs 把来源与上限带进查询串', async () => {
    const { app, platform } = appFor();
    await call(app, 'tail_logs', { source: 'slot', slot: 'preview', limit: 50 });
    const logs = platform.calls.find((c) => c.url.includes('/logs'));
    expect(logs?.url).toContain('source=slot');
    expect(logs?.url).toContain('slot=preview');
    expect(logs?.url).toContain('limit=50');
  });
});

describe('操作 MCP：拒绝与失败', () => {
  test('没有网关身份头时所有工具都拒绝，且不打平台', async () => {
    const { app, platform } = appFor();
    const { payload } = await call(app, 'list_branches', {}, {});
    expect(isErrorResult(payload)).toBe(true);
    expect(firstText(payload)).toContain(IDENTITY_HEADERS.sourceService);
    expect(platform.calls).toHaveLength(0);
  });

  test('cs-api 拒绝时原话上浮，MCP 不自己判定权限', async () => {
    const { app } = appFor((request) =>
      request.url.endsWith('/publish')
        ? jsonResponse(412, { error: 'precondition', message: '工作区有未提交更改', details: { uncommitted: ['src/app.ts'] } })
        : route(request));
    const { payload } = await call(app, 'publish_release', { branch: 'main' });
    expect(isErrorResult(payload)).toBe(true);
    expect(firstText(payload)).toContain('工作区有未提交更改');
    expect(firstText(payload)).toContain('src/app.ts');
    expect(firstText(payload)).toContain('precondition');
  });

  test('开发会话已释放时 403 原样返回', async () => {
    const { app } = appFor((request) =>
      request.url.endsWith('/dev-session')
        ? jsonResponse(403, { error: 'forbidden', message: '开发会话已释放，无法操作', details: {} })
        : route(request));
    const { payload } = await call(app, 'read_preview_status', {});
    expect(firstText(payload)).toContain('开发会话已释放');
  });
});
