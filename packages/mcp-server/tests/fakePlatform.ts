import type { FetchLike } from '@crewstation/api-client';
import type { ApiOperationDto, CapabilityDescriptionDto, ProjectDto } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '@crewstation/http';

export const PROJECT_ID = '01a0bf5d-8f4b-7c8b-8b95-1301eee8667f';
export const SERVICE_ID = '01a0bf5d-8f4b-7aea-8983-7b41e8b30563';
export const CALLER_IDENTITY = 'demo/worker';

export interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | undefined;
}

export const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** 记录请求并按路由应答的假平台；单测不需要集群，也不需要真的 cs-api。 */
export function fakePlatform(route: (request: CapturedRequest) => Response): { calls: CapturedRequest[]; fetchImpl: FetchLike } {
  const calls: CapturedRequest[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const captured: CapturedRequest = {
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(captured);
    return route(captured);
  };
  return { calls, fetchImpl };
}

export const projectPage = (): { items: ProjectDto[] } => ({
  items: [{
    id: PROJECT_ID as ProjectDto['id'],
    slug: 'demo',
    name: '样例数字人',
    kind: 'DigitalWorker',
    namespace: 'cs-demo',
    ownerUserId: '01a0bf5d-8f4b-724c-8db6-5ac36a878a7d' as ProjectDto['ownerUserId'],
    state: 'active',
    serviceId: SERVICE_ID as ProjectDto['serviceId'],
    createdAt: '2026-09-11T00:00:00.000Z',
  }],
});

const fixtureIds = new Map<string, string>();
const fixtureId = (key: string) => { if (!fixtureIds.has(key)) fixtureIds.set(key, Bun.randomUUIDv7()); return fixtureIds.get(key)!; };
export const operation = (proxy: string, path: string, granted: boolean): ApiOperationDto => ({
  id: fixtureId(`operation:${proxy}:${path}`), proxyId: fixtureId(`proxy:${proxy}`), proxy, method: 'GET', path, summary: `读取 ${path}`, openPolicy: granted ? 'default' : 'targeted', granted,
});

export const capabilityDescription = (): CapabilityDescriptionDto => ({
  service: { identity: CALLER_IDENTITY, slug: 'demo', namespace: 'cs-demo' },
  hosts: { prod: 'demo.cs.localhost', preview: 'preview.demo.cs.localhost', dev: 'dev.demo.cs.localhost', service: 'worker.svc.cs.internal', platformApi: 'api.svc.cs.internal' },
  conventions: { identityHeaders: { ...IDENTITY_HEADERS }, env: { CS_PROJECT: 'CS_PROJECT' }, paths: { health: '/healthz' }, eventHeaders: {} },
  identityForwarding: { source: 'global', fields: ['name', 'email'], headers: ['x-cs-identity-token', 'x-cs-user-email', 'x-cs-user-id', 'x-cs-user-name'], tokenClaims: ['email', 'name'] },
  quota: { maxConcurrentTasks: 3, running: 1 },
  plan: { id: '01a0bf5d-8f4b-7eac-826b-82ee81e33869', name: 'standard-small', cpu: '500m', memory: '512Mi', maxReplicas: 2, description: '' },
  config: { development: ['GREETING'], production: ['GREETING'] },
  data: [],
  operations: [],
  computeProfiles: [],
  subscriptions: [],
  mcp: [{ name: 'capabilities', url: 'http://mcp-capabilities.svc.cs.internal/mcp' }],
  businessTaskApi: [{ method: 'POST', path: '/v1/business-tasks', summary: '创建业务任务' }],
  generatedAt: '2026-09-11T00:00:00.000Z',
});

/** 网关在服务域注入的调用方身份；不带它就是“直连 MCP”，必须被干净拒绝。 */
export const callerHeaders = (identity: string = CALLER_IDENTITY): Record<string, string> => ({
  [IDENTITY_HEADERS.sourceService]: identity,
  [IDENTITY_HEADERS.sourceToken]: 'signed-source-token',
  [IDENTITY_HEADERS.traceId]: '0'.repeat(32),
});

export interface RpcOptions {
  readonly headers?: Record<string, string>;
  readonly path?: string;
}

/** 向 MCP 端点发一次 JSON-RPC 请求并解出 result／error。 */
export async function rpc(app: Hono<AppEnv>, body: unknown, options: RpcOptions = {}): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await app.request(options.path ?? '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...options.headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, payload: text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>) };
}

export const INITIALIZE = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};

/** 从 tools/call 或 resources/read 的响应里取出第一段文本。 */
export function firstText(payload: Record<string, unknown>): string {
  const result = payload.result as { content?: Array<{ text?: string }>; contents?: Array<{ text?: string }> } | undefined;
  return result?.content?.[0]?.text ?? result?.contents?.[0]?.text ?? '';
}

export function isErrorResult(payload: Record<string, unknown>): boolean {
  return (payload.result as { isError?: boolean } | undefined)?.isError === true;
}
