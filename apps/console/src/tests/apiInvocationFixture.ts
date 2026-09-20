import { act } from 'react';
import { focusManager } from '@tanstack/react-query';
import type { ApiInvocationRequest, ApiOperationDto } from '@crewstation/contracts';
import { ApiInvocationRequestSchema, TaskIdSchema } from '@crewstation/contracts';
import type { RenderedApp } from './renderApp';
import { testerSummaryFixture, trialMarketFixture } from './projectSummaryFixture';

export const invocationProjectId = `prj_${'a'.repeat(32)}`, invocationTaskId = TaskIdSchema.parse(`tsk_${'c'.repeat(32)}`);
const serviceId = `svc_${'b'.repeat(32)}`, userId = `usr_${'d'.repeat(32)}`;
export const invocationOperation: ApiOperationDto = { key: 'crm:POST:/items/{id}', proxy: 'crm', method: 'POST', path: '/items/{id}', summary: '保存条目', openPolicy: 'default', granted: true };
export const secondInvocationOperation: ApiOperationDto = { key: 'crm:GET:/ping', proxy: 'crm', method: 'GET', path: '/ping', openPolicy: 'default', granted: true };
export const invocationRoute = `/projects/${invocationProjectId}/settings?tab=resources&resource=api`;

export function invocationResponse(input: ApiInvocationRequest, overrides: Record<string, unknown> = {}) {
  return { taskId: input.expectedTaskId, operationKey: input.operationKey, result: { status: 422, headers: { 'content-type': 'application/json' }, body: '{"message":"业务校验失败"}', truncated: false, bodyTruncated: false, headersTruncated: false, durationMs: 17 }, ...overrides };
}

export function apiInvocationFixture() {
  const calls: Array<{ url: string; input: ApiInvocationRequest }> = [], reads: string[] = [];
  const state = { taskId: invocationTaskId, role: 'developer', sessionFailure: false, catalogFailure: false, granted: true, documentFailure: false, documentVersion: '1.0.0', malformedSession: false };
  const pending: { handle?: (input: ApiInvocationRequest) => Promise<Response> } = {};
  globalThis.fetch = (async (raw, init) => {
    const url = String(raw);
    if (url.endsWith('/api-invocations') && init?.method === 'POST') {
      const input = ApiInvocationRequestSchema.parse(JSON.parse(String(init.body)));
      calls.push({ url, input });
      return pending.handle ? pending.handle(input) : Response.json(invocationResponse(input));
    }
    reads.push(url);
    if (url.endsWith('/v1/me')) return Response.json({ id: userId, name: '开发者', platformRole: 'developer', isAdmin: false, memberships: [{ projectId: invocationProjectId, role: state.role }] });
    if (new URL(url, 'http://localhost').pathname === '/v1/market/apps') return Response.json({ items: [trialMarketFixture(invocationProjectId)] });
    if (url.endsWith(`/v1/market/apps/${invocationProjectId}`)) return Response.json(trialMarketFixture(invocationProjectId));
    if (url.endsWith(`/v1/workbench/project-summaries/${invocationProjectId}`)) return Response.json(testerSummaryFixture(invocationProjectId, serviceId));
    if (url.endsWith(`/v1/projects/${invocationProjectId}`)) return Response.json({ id: invocationProjectId, serviceId, name: '知识助理', slug: 'knowledge', kind: 'DigitalWorker', state: 'active' });
    if (url.endsWith('/dev-session')) {
      if (state.sessionFailure) return Response.json({ error: 'unavailable', message: '会话目录暂不可用' }, { status: 503 });
      return Response.json({ taskId: state.taskId, projectId: state.malformedSession ? 'wrong-project' : invocationProjectId, state: 'running', branch: 'main', previewHost: 'dev.fixture.invalid', preview: 'ready', createdBy: userId, createdAt: '2026-09-13T01:00:00.000Z', lastActivityAt: '2026-09-13T01:00:00.000Z' });
    }
    if (url.includes('/catalog/operations')) return state.catalogFailure ? Response.json({ error: 'unavailable', message: '接口目录暂不可用' }, { status: 503 }) : Response.json({ items: [{ ...invocationOperation, granted: state.granted }, secondInvocationOperation] });
    if (url.includes('/openapi?')) return state.documentFailure ? Response.json({ error: 'unavailable', message: '文档暂不可用' }, { status: 503 }) : Response.json(invocationSpec(state.documentVersion));
    if (url.endsWith('/catalog/proxies')) return Response.json({ items: [{ proxy: 'crm' }, { proxy: 'billing' }] });
    return Response.json({ items: [] });
  }) as typeof fetch;
  return { state, pending, calls, reads };
}

export function invocationSpec(version = '1.0.0') {
  return { openapi: '3.0.3', info: { title: 'CRM', version }, servers: [{ url: 'http://api.fixture.invalid/api/crm' }], paths: {
    '/items/{id}': { post: { summary: '保存条目', operationId: 'saveItem', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'search', in: 'query', schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' } } } } } }, responses: { '200': { description: 'saved' } } } },
    '/ping': { get: { operationId: 'ping', parameters: [{ name: 'value', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
  } };
}

export async function invocationClick(page: RenderedApp, label: string, root: ParentNode = document) {
  const target = [...root.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label);
  if (!target) throw new Error(`找不到按钮 ${label}: ${page.text()}`);
  // happy-dom.click 不移动焦点；真实点击会先 blur 输入，让 Swagger 的防抖参数提交。
  await act(async () => { target.focus(); target.click(); }); await page.settle();
}

export async function invocationInput(page: RenderedApp, node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    node.focus(); Object.getOwnPropertyDescriptor(node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  }); await page.settle();
}

export const invocationField = (name: string) => [...document.querySelectorAll('label')].find((node) => node.textContent?.trim().startsWith(name))!.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')!;
export async function refreshInvocationQueries(page: RenderedApp) {
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
}
