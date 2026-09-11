import { describe, expect, test } from 'bun:test';
import { ApiClientError } from '@crewstation/api-client';
import { z } from 'zod';
import type { McpServerDefinition } from '../index';
import { createMcpApp, defineResource, describeFailure, jsonResource, mcpPathFrom, toolFactory } from '../index';
import { INITIALIZE, firstText, isErrorResult, rpc } from './fakePlatform';

interface ProbeContext {
  readonly greeting: string;
  readonly fail?: unknown;
}

const tool = toolFactory<ProbeContext>();

const definition: McpServerDefinition<ProbeContext> = {
  name: 'probe',
  version: '9.9.9',
  instructions: '测试用服务器',
  resources: [
    defineResource<ProbeContext>({
      name: 'note', uri: 'cs://probe/note', title: '便条', description: '一段纯文本', mimeType: 'text/markdown',
      read: async (ctx) => ({ mimeType: 'text/markdown', text: `# ${ctx.greeting}` }),
    }),
    jsonResource<ProbeContext>({
      name: 'state', uri: 'cs://probe/state', title: '状态', description: '一段 JSON',
      read: async (ctx) => {
        if (ctx.fail) throw ctx.fail;
        return { greeting: ctx.greeting };
      },
    }),
  ],
  tools: [
    tool({
      name: 'echo', title: '回声', description: '把 text 原样返回 count 次',
      input: { text: z.string().min(1), count: z.number().int().min(1).max(3).optional() },
      run: async (args, ctx) => {
        if (ctx.fail) throw ctx.fail;
        return { text: args.text.repeat(args.count ?? 1), greeting: ctx.greeting };
      },
    }),
  ],
};

const appWith = (ctx: ProbeContext) => createMcpApp({ name: 'probe', path: '/mcp', definition, contextFor: () => ctx });

describe('MCP 协议层：握手与目录', () => {
  const app = appWith({ greeting: '你好' });

  test('initialize 回协议版本、服务器名与能力', async () => {
    const { status, payload } = await rpc(app, INITIALIZE);
    expect(status).toBe(200);
    expect(payload.result).toMatchObject({
      serverInfo: { name: 'probe', version: '9.9.9' },
      capabilities: { resources: {}, tools: {} },
      instructions: '测试用服务器',
    });
  });

  test('resources/list 列出全部资源的 uri、标题与 mimeType', async () => {
    const { payload } = await rpc(app, { jsonrpc: '2.0', id: 2, method: 'resources/list' });
    const resources = (payload.result as { resources: Array<{ uri: string; name: string; mimeType: string }> }).resources;
    expect(resources.map((r) => r.uri)).toEqual(['cs://probe/note', 'cs://probe/state']);
    expect(resources[0]?.mimeType).toBe('text/markdown');
    expect(resources[1]?.mimeType).toBe('application/json');
  });

  test('resources/read 返回正文，JSON 资源被序列化', async () => {
    const note = await rpc(app, { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'cs://probe/note' } });
    expect(firstText(note.payload)).toBe('# 你好');
    const state = await rpc(app, { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'cs://probe/state' } });
    expect(JSON.parse(firstText(state.payload))).toEqual({ greeting: '你好' });
  });

  test('未知 uri 的 resources/read 回 JSON-RPC 错误', async () => {
    const { payload } = await rpc(app, { jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'cs://probe/missing' } });
    expect(payload.error).toBeDefined();
  });

  test('tools/list 把 zod shape 变成 JSON Schema，可选字段不进 required', async () => {
    const { payload } = await rpc(app, { jsonrpc: '2.0', id: 6, method: 'tools/list' });
    const tools = (payload.result as { tools: Array<{ name: string; description: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }> }).tools;
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('echo');
    expect(tools[0]?.description).toContain('原样返回');
    expect(Object.keys(tools[0]?.inputSchema.properties ?? {})).toEqual(['text', 'count']);
    expect(tools[0]?.inputSchema.required).toEqual(['text']);
  });
});

describe('MCP 协议层：调用与错误', () => {
  const app = appWith({ greeting: '你好' });

  test('tools/call 成功时返回文本化结果', async () => {
    const { payload } = await rpc(app, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'echo', arguments: { text: 'ab', count: 2 } } });
    expect(isErrorResult(payload)).toBe(false);
    expect(JSON.parse(firstText(payload))).toEqual({ text: 'abab', greeting: '你好' });
  });

  test('入参不合法时是工具错误而不是协议错误，文本说明缺什么', async () => {
    const { payload } = await rpc(app, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'echo', arguments: { count: 9 } } });
    expect(payload.error).toBeUndefined();
    expect(isErrorResult(payload)).toBe(true);
    expect(firstText(payload)).toContain('text');
  });

  test('平台拒绝的原话原样出现在工具错误里', async () => {
    const refused = new ApiClientError(403, { error: 'forbidden', message: '开发会话已释放', details: { taskId: 'tsk_1' } });
    const { payload } = await rpc(appWith({ greeting: '你好', fail: refused }), {
      jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'echo', arguments: { text: 'x' } },
    });
    expect(isErrorResult(payload)).toBe(true);
    expect(firstText(payload)).toContain('开发会话已释放');
    expect(firstText(payload)).toContain('forbidden');
    expect(firstText(payload)).toContain('tsk_1');
  });

  test('资源读取失败时是 JSON-RPC 错误，消息可读', async () => {
    const refused = new ApiClientError(401, { error: 'unauthenticated', message: '缺少调用方身份', details: {} });
    const { payload } = await rpc(appWith({ greeting: '你好', fail: refused }), {
      jsonrpc: '2.0', id: 10, method: 'resources/read', params: { uri: 'cs://probe/state' },
    });
    expect((payload.error as { message: string }).message).toContain('缺少调用方身份');
  });

  test('describeFailure 覆盖三类错误', () => {
    expect(describeFailure(new ApiClientError(409, { error: 'conflict', message: '标签已存在', details: {} }))).toBe('平台拒绝（conflict，HTTP 409）：标签已存在');
    expect(describeFailure(new Error('普通错误'))).toBe('普通错误');
    expect(describeFailure('字符串')).toBe('字符串');
  });
});

describe('MCP 端点：无状态约定', () => {
  const app = appWith({ greeting: '你好' });

  test('健康检查仍在 /healthz', async () => {
    expect(await (await app.request('/healthz')).json()).toEqual({ ok: true, service: 'probe' });
  });

  test('GET 与 DELETE 明确回绝，带 JSON-RPC 形状的错误', async () => {
    for (const method of ['GET', 'DELETE']) {
      const response = await app.request('/mcp', { method });
      expect(response.status).toBe(405);
      expect((await response.json() as { error: { message: string } }).error.message).toContain('无状态');
    }
  });

  test('通知（无 id）被接受且无响应体', async () => {
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  test('mcpPathFrom 取平台下发地址的路径，取不到时回落 /mcp', () => {
    expect(mcpPathFrom('http://mcp-operations.svc.cs.internal/mcp')).toBe('/mcp');
    expect(mcpPathFrom('http://mcp-operations.svc.cs.internal/platform/mcp')).toBe('/platform/mcp');
    expect(mcpPathFrom('http://mcp-operations.svc.cs.internal/')).toBe('/mcp');
    expect(mcpPathFrom(undefined)).toBe('/mcp');
    expect(mcpPathFrom('不是地址')).toBe('/mcp');
  });
});
