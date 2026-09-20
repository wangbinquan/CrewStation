import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { renderApp } from './renderApp';
import { trialMarketFixture } from './projectSummaryFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const projectId = `prj_${'b'.repeat(32)}`;
function fixture() {
  const state = { app: trialMarketFixture(projectId), failed: false }, calls: string[] = [];
  globalThis.fetch = (async (raw) => {
    const path = new URL(String(raw), 'http://localhost').pathname; calls.push(path);
    if (path === '/v1/me') return Response.json({ id: 'usr_trial', name: '试用成员', platformRole: 'user', isAdmin: false, memberships: [{ projectId, role: 'tester' }] });
    if (state.failed) return Response.json({ error: 'unavailable', message: '应用读取失败' }, { status: 503 });
    if (path === '/v1/market/apps') return Response.json({ items: [state.app] });
    if (path === `/v1/market/apps/${projectId}`) return Response.json(state.app);
    throw new Error(`试用界面不能查询内部数据：${path}`);
  }) as typeof fetch;
  return { state, calls };
}

test('普通试用成员由首页 Beta 直接试用，旧项目链接回到应用详情且不读取技术接口', async () => {
  const f = fixture(); page = await renderApp('/');
  expect(document.querySelector('a[href="http://preview.demo.test"]')?.textContent).toContain('试用应用');
  expect(page.text()).toContain('Beta'); expect(page.text()).toContain('共用业务数据');
  await page.click('数字助手 1'); expect(page.path()).toBe(`/market/${projectId}`);
  expect(page.text()).not.toContain('开发'); expect(document.querySelector('[aria-label="项目页面"]')).toBeNull();
  await page.navigate(`/projects/${projectId}/settings?tab=config`);
  expect(page.path()).toBe(`/market/${projectId}`); expect(page.text()).toContain('Beta');
  expect(f.calls.every((path) => path === '/v1/me' || path.startsWith('/v1/market/apps'))).toBe(true);
});

test('试用读取失败与未就绪不保留旧链接，刷新恢复可用，未知状态不冒充未上线 Beta', async () => {
  const f = fixture(); page = await renderApp(`/market/${projectId}`);
  expect(document.querySelector('a[href="http://preview.demo.test"]')).not.toBeNull();
  f.state.failed = true; await page.click('重新检查'); expect(page.text()).toContain('应用读取失败');
  expect(document.querySelector('a[href="http://preview.demo.test"]')).toBeNull();
  f.state.failed = false; f.state.app.entry = { kind: 'trial', status: 'unavailable' };
  await page.click('重新检查'); expect(document.querySelector('a[href="http://preview.demo.test"]')).toBeNull();
  f.state.app = trialMarketFixture(projectId); await page.click('重新检查');
  expect(document.querySelector('a[href="http://preview.demo.test"]')).not.toBeNull();
  f.state.app.entry = { kind: 'production', status: 'unknown' };
  f.state.app.production = { status: 'unknown', freshness: 'unknown', checkedAt: new Date().toISOString() };
  await page.click('重新检查'); expect(page.text()).not.toContain('Beta');
  expect(document.querySelector('a[href="http://preview.demo.test"]')).toBeNull();
});
