import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import type { RenderedApp } from './renderApp';
import { renderApp } from './renderApp';
import { projectIdentityRereadMs } from '../shared/project/useProjectIdentity';

interface Handler {
  readonly match: string;
  readonly exactPath?: boolean;
  readonly status?: number;
  readonly body?: unknown;
}

let handlers: Handler[] = [];
let app: RenderedApp | undefined;
const projectId = '01a0bf5d-8f4b-7fcb-815b-e99537cac400';
const MEMBER = { id: '01a0bf5d-8f4b-7c24-887c-cad9850d2759', name: '普通成员', email: 'm@example.com', platformRole: 'developer', isAdmin: false, memberships: [], authMethod: 'password' as const };

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const handler = handlers.find((h) => h.exactPath ? new URL(url, 'http://localhost').pathname === h.match : url.includes(h.match));
  if (handler === undefined) return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify(handler.body ?? {}), { status: handler.status ?? 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

afterEach(() => {
  app?.unmount();
  app = undefined;
});

describe('非成员打开项目地址（RFC-003 §3 无权限）', () => {
  test('404：说明对象与两种可能原因，左栏只留返回与 ID，没有五个空入口', async () => {
    handlers = [
      { match: '/v1/me', body: MEMBER },
      { match: `/v1/projects/${projectId}`, exactPath: true, status: 404, body: { error: 'not_found', message: `项目 ${projectId} 不存在` } },
    ];
    app = await renderApp(`/projects/${projectId}/operations`);
    expect(app.text()).toContain('找不到该项目');
    expect(app.text()).toContain(`项目 ${projectId} 不存在，或你不是它的成员`);
    // 不写成“暂无数据”或普通读取失败，也不把五个页面入口留给同一个说明页。
    expect(app.text()).not.toContain('读取失败');
    expect(app.html()).not.toContain(`href="/projects/${projectId}/release"`);
    expect(app.html()).not.toContain(`href="/projects/${projectId}/settings"`);
    // 没有「重新读取项目」按钮（2026-09-23 裁定）：读不到项目时每 30 秒自己再读一次，刚被加入成员不必手动重读。
    expect(app.text()).not.toContain('重新读取项目');
    expect(app.html()).toContain('href="/projects"');
    await app.click('返回数字人项目');
    expect(app.path()).toBe('/projects');
  });

  test('服务端 503：读取失败会自动重读，入口保留', async () => {
    handlers = [
      { match: '/v1/me', body: MEMBER },
      { match: `/v1/projects/${projectId}`, exactPath: true, status: 503, body: { error: 'internal', message: '项目服务不可用' } },
    ];
    app = await renderApp(`/projects/${projectId}`);
    expect(app.text()).toContain('项目服务不可用');
    expect(app.text()).toContain('稍后会自动重新读取'); expect(app.text()).not.toContain('重新读取项目');
    expect(app.text()).not.toContain('找不到该项目');
    expect(app.html()).toContain(`href="/projects/${projectId}/release"`);
  });
});

test('读不到项目时每 30 秒自己再读；读到之后不再例行重读', () => {
  expect(projectIdentityRereadMs(undefined)).toBe(30_000);
  expect(projectIdentityRereadMs({ id: projectId })).toBeUndefined();
});
