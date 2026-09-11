import { describe, expect, test } from 'bun:test';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { capabilitiesServerDefinition, capabilityContextFor, capabilityResources, conventionGuide, createMcpApp } from '../index';
import type { CapturedRequest } from './fakePlatform';
import { INITIALIZE, PROJECT_ID, callerHeaders, capabilityDescription, fakePlatform, firstText, jsonResponse, projectPage, rpc } from './fakePlatform';

const PLATFORM = 'http://api.svc.cs.internal';

function route(request: CapturedRequest): Response {
  if (request.url === `${PLATFORM}/v1/projects`) return jsonResponse(200, projectPage());
  if (request.url === `${PLATFORM}/v1/projects/${PROJECT_ID}/capabilities`) return jsonResponse(200, capabilityDescription());
  return jsonResponse(404, { error: 'not_found', message: `没有路由 ${request.url}`, details: {} });
}

function appFor(handler: (request: CapturedRequest) => Response = route) {
  const platform = fakePlatform(handler);
  const app = createMcpApp({
    name: 'mcp-capabilities',
    path: '/mcp',
    definition: capabilitiesServerDefinition('0.1.0'),
    contextFor: (request) => capabilityContextFor({ platformApiUrl: PLATFORM, fetch: platform.fetchImpl }, request),
  });
  return { app, platform };
}

describe('能力说明 MCP：资源目录', () => {
  test('每个能力段一个 resource，另加静态约定说明，且不暴露任何工具', async () => {
    const { app } = appFor();
    const list = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'resources/list' }, { headers: callerHeaders() });
    const names = (list.payload.result as { resources: Array<{ name: string; uri: string }> }).resources.map((r) => r.name);
    expect(names).toEqual([
      'service-identity', 'hosts', 'conventions', 'config-keys', 'data-resources', 'callable-operations',
      'event-subscriptions', 'quota-and-plan', 'mcp-endpoints', 'business-task-api', 'capability-description', 'integration-guide',
    ]);
    expect(capabilitiesServerDefinition('0.1.0').tools).toHaveLength(0);
  });

  test('resources/read 按段返回能力说明的对应片段', async () => {
    const { app, platform } = appFor();
    const hosts = await rpc(app, { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'cs://capability/hosts' } }, { headers: callerHeaders() });
    expect(JSON.parse(firstText(hosts.payload))).toEqual(capabilityDescription().hosts);
    const quota = await rpc(app, { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'cs://capability/quota-and-plan' } }, { headers: callerHeaders() });
    expect(JSON.parse(firstText(quota.payload))).toEqual({ quota: { maxConcurrentTasks: 3, running: 1 }, plan: capabilityDescription().plan });
    expect(platform.calls.map((c) => c.url)).toEqual([
      `${PLATFORM}/v1/projects`, `${PLATFORM}/v1/projects/${PROJECT_ID}/capabilities`,
      `${PLATFORM}/v1/projects`, `${PLATFORM}/v1/projects/${PROJECT_ID}/capabilities`,
    ]);
  });

  test('出站调用透传调用方身份，MCP 不用自己的身份代办', async () => {
    const { app, platform } = appFor();
    await rpc(app, { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'cs://capability/service' } }, { headers: callerHeaders() });
    expect(platform.calls[0]?.headers.get(IDENTITY_HEADERS.sourceService)).toBe('demo/worker');
    expect(platform.calls[0]?.headers.get(IDENTITY_HEADERS.sourceToken)).toBe('signed-source-token');
    expect(platform.calls[0]?.headers.get(IDENTITY_HEADERS.traceId)).toBe('0'.repeat(32));
  });

  test('缺少网关身份头时干净拒绝，并指出缺的是哪个头', async () => {
    const { app, platform } = appFor();
    const { payload } = await rpc(app, { jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'cs://capability/service' } });
    expect((payload.error as { message: string }).message).toContain(IDENTITY_HEADERS.sourceService);
    expect(platform.calls).toHaveLength(0);
  });

  test('身份对不上项目时，平台的 not_found 原样上浮', async () => {
    const { app } = appFor();
    const { payload } = await rpc(app, { jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: 'cs://capability/service' } }, { headers: callerHeaders('other/worker') });
    expect((payload.error as { message: string }).message).toContain('other');
  });

  test('静态约定说明不需要身份，内容取自 contracts 常量', async () => {
    const { app, platform } = appFor();
    const { payload } = await rpc(app, { jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri: 'cs://guide/integration' } });
    const text = firstText(payload);
    expect(text).toContain(IDENTITY_HEADERS.sourceService);
    expect(text).toContain('CS_INTERNAL_API_BASE');
    expect(text).toContain('git push` 不是发布');
    expect(platform.calls).toHaveLength(0);
    expect(conventionGuide()).toBe(text);
  });

  test('同一请求内多段共用一次能力说明查询', async () => {
    const platform = fakePlatform(route);
    const request = new Request('http://mcp/mcp', { headers: callerHeaders() });
    const ctx = capabilityContextFor({ platformApiUrl: PLATFORM, fetch: platform.fetchImpl }, request);
    await Promise.all([ctx.description(), ctx.description(), ctx.description()]);
    expect(platform.calls).toHaveLength(2);
  });

  test('资源定义齐全：uri 唯一、标题与描述都写了', () => {
    const resources = capabilityResources();
    expect(new Set(resources.map((r) => r.uri)).size).toBe(resources.length);
    for (const resource of resources) {
      expect(resource.title.length).toBeGreaterThan(0);
      expect(resource.description.length).toBeGreaterThan(10);
    }
  });

  test('握手时把“先读什么”写进 instructions，且不声明 tools 能力', async () => {
    const { app } = appFor();
    const { payload } = await rpc(app, INITIALIZE, { headers: callerHeaders() });
    const result = payload.result as { instructions: string; capabilities: Record<string, unknown> };
    expect(result.instructions).toContain('cs://guide/integration');
    expect(Object.keys(result.capabilities)).toEqual(['resources']);
  });
});

