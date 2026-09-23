import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch, projectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34', serviceId = '01a0bf5d-8f4b-760b-86b6-0bb9f08a9eaa', userId = '01a0bf5d-8f4b-7ed2-8386-a4b2e1a36efb';
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture() {
  const calls: string[] = [];
  globalThis.fetch = (async (raw) => {
    const path = new URL(String(raw), 'http://localhost').pathname; calls.push(path);
    let body: unknown = { items: [] }, status = 200;
    if (path === '/v1/me') body = { id: userId, name: '负责人', platformRole: 'developer', isAdmin: false, memberships: [{ projectId, role: 'owner' }] };
    else if (path === `/v1/projects/${projectId}`) body = { id: projectId, serviceId, name: '示例', slug: 'demo', kind: 'DigitalWorker', state: 'active' };
    else if (path.endsWith('/config/production/versions')) body = { items: [7, 3, 5].map((version) => ({ env: 'production', version, keys: [], createdAt: '2026-09-13T01:00:00.000Z' })) };
    else if (path.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '无会话' }; }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls };
}
const visibleCardTitles = () => [...document.querySelectorAll('main section > header > h2')].filter((node) => !node.closest('[hidden]')).map((node) => node.textContent);

// 2026-09-23 作者裁定：「生产配置与部署版本」卡整张删除（RFC-009 proposal §3.3、design §3.1 同日再修订）。
test('生产组不再有「生产配置与部署版本」卡，也不为它读部署槽与发布记录；生效条件仍写在变量卡上', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config&env=production`);
  expect(visibleCardTitles()).toContain('生产变量'); expect(visibleCardTitles()).not.toContain('生产配置与部署版本');
  expect(page.text()).not.toContain('记录为第'); expect(page.text()).not.toContain('查看发布与上线');
  expect(f.calls.some((path) => path.endsWith('/slots') || path.startsWith('/v1/releases/'))).toBe(false);
  expect(page.text()).toContain('保存不会自动改变现有进程，下一次发布按新配置注入');
});

test('生产变量卡的版本历史直接展示，不用先点开', async () => {
  fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config&env=production`);
  // 2026-09-23 作者裁定不再折叠（RFC-009 design §3.1 修订）。
  const history = [...document.querySelectorAll('h3')].find((node) => node.textContent === '版本历史' && !node.closest('[hidden]'));
  expect(history !== undefined).toBe(true); expect(history!.closest('details') === null).toBe(true);
  expect([...history!.closest('footer')!.querySelectorAll('li')].map((node) => node.firstElementChild?.textContent)).toEqual(['版本 7', '版本 3', '版本 5']);
});
