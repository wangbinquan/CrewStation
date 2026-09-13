import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch, projectId = `prj_${'a'.repeat(32)}`, serviceId = `svc_${'b'.repeat(32)}`, userId = `usr_${'c'.repeat(32)}`;
const prodId = `rel_${'d'.repeat(32)}`, previewId = `rel_${'e'.repeat(32)}`, sha = 'f'.repeat(40);
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture() {
  const state = { slotsFailure: false, historyFailure: false, releaseFailure: false, mismatch: false, noService: false, emptyProd: false, missingSlot: false, prodVersion: 3 as number | undefined, history: [7, 3, 5] };
  const calls: Array<{ path: string; method: string }> = [];
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET'; calls.push({ path, method });
    let body: unknown = { items: [] }, status = 200;
    if (path === '/v1/me') body = { id: userId, name: '负责人', isAdmin: false, memberships: [{ projectId, role: 'owner' }] };
    else if (path === `/v1/projects/${projectId}`) body = { id: projectId, serviceId: state.noService ? undefined : serviceId, name: '示例', slug: 'demo', kind: 'DigitalWorker', state: 'active' };
    else if (path.endsWith('/slots')) {
      if (state.slotsFailure) { status = 503; body = { error: 'unavailable', message: '部署槽读取失败' }; }
      else body = { items: state.missingSlot ? [] : [
        { name: 'prod', active: true, releaseId: state.emptyProd ? undefined : prodId, state: state.emptyProd ? 'empty' : 'ready', commitSha: state.emptyProd ? undefined : sha },
        { name: 'preview', active: false, releaseId: previewId, state: 'deploying', commitSha: sha },
      ] };
    } else if (path.endsWith('/config/production/versions')) {
      if (state.historyFailure) { status = 503; body = { error: 'unavailable', message: '配置历史读取失败' }; }
      else body = { items: state.history.map((version) => ({ env: 'production', version, keys: [], createdAt: '2026-09-13T01:00:00.000Z' })) };
    } else if (path.startsWith('/v1/releases/')) {
      const id = path.split('/').at(-1)!;
      if (state.releaseFailure && id === prodId) { status = 503; body = { error: 'unavailable', message: '正式发布读取失败' }; }
      else body = { id, serviceId: state.mismatch && id === prodId ? 'another-service' : serviceId, commitSha: sha, tag: id === prodId ? 'v1.0.0' : 'v1.1.0', configVersion: id === prodId ? state.prodVersion : 7 };
    } else if (path.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '无会话' }; }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, calls };
}
const row = (label: string) => [...document.querySelectorAll('tr')].find((element) => element.querySelector('td')?.textContent?.startsWith(label))!;

test('生产配置对照读取两槽精确 Release，使用全组历史版本并区分实际部署状态', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`);
  expect(f.calls.some((call) => call.path.endsWith('/slots'))).toBe(false);
  await page.click('生产取值组'); expect(page.text()).toContain('当前已保存的生产配置：第 7 版');
  expect(row('正式版本').textContent).toContain('v1.0.0'); expect(row('正式版本').textContent).toContain('记录为第 3 版'); expect(row('正式版本').textContent).toContain('已有更新的配置');
  expect(row('待验证版本').textContent).toContain('部署中'); expect(row('待验证版本').textContent).toContain('与当前保存版本一致');
  expect(page.text()).toContain('实际注入键由各版本的 Manifest 决定');
  expect(new Set(f.calls.filter((call) => call.path.startsWith('/v1/releases/')).map((call) => call.path))).toEqual(new Set([`/v1/releases/${prodId}`, `/v1/releases/${previewId}`]));
  expect(f.calls.some((call) => call.path === `/v1/services/${serviceId}/releases`)).toBe(false);
  expect(f.calls.every((call) => call.method === 'GET')).toBe(true);
});

test('刷新失败不保留旧的一致结论；发布快照缺失与不一致分别保留未知并可恢复', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config&env=production`);
  f.state.historyFailure = true; f.state.releaseFailure = true; await page.click('刷新版本对照');
  expect(page.text()).toContain('当前保存版本尚未确认'); expect(row('正式版本').textContent).toContain('正式发布读取失败'); expect(row('正式版本').textContent).not.toContain('第 3 版');
  expect(row('待验证版本').textContent).not.toContain('与当前保存版本一致');
  f.state.historyFailure = false; f.state.releaseFailure = false; f.state.prodVersion = undefined; await page.click('刷新版本对照');
  expect(row('正式版本').textContent).toContain('配置快照版本未确认'); expect(row('正式版本').textContent).not.toContain('与当前保存版本一致');
  f.state.prodVersion = 3; f.state.mismatch = true; await page.click('刷新版本对照'); expect(row('正式版本').textContent).toContain('发布记录不一致');
  f.state.mismatch = false; await page.click('刷新版本对照'); expect(row('正式版本').textContent).toContain('记录为第 3 版');
});

test('空槽、缺少槽、未开通服务与全组空版本各自显示真实状态', async () => {
  const f = fixture(); f.state.emptyProd = true; page = await renderApp(`/projects/${projectId}/settings?tab=config&env=production`);
  expect(row('正式版本').textContent).toContain('尚未部署'); expect(f.calls.some((call) => call.path === `/v1/releases/${prodId}`)).toBe(false);
  f.state.missingSlot = true; await page.click('刷新版本对照'); expect(row('正式版本').textContent).toContain('部署记录未确认'); expect(row('正式版本').textContent).not.toContain('尚未部署');
  page.unmount(); f.state.noService = true; f.calls.length = 0; f.state.history = []; page = await renderApp(`/projects/${projectId}/settings?tab=config&env=production`);
  expect(page.text()).toContain('项目尚未开通服务'); expect(page.text()).toContain('当前已保存的生产配置：第 0 版');
  expect(f.calls.some((call) => call.path.endsWith('/slots') || call.path.startsWith('/v1/releases/'))).toBe(false);
});

test('槽读取失败不冒充未部署，保存历史滞后不把已部署配置说成更新尚未采用', async () => {
  const f = fixture(); f.state.history = [1]; page = await renderApp(`/projects/${projectId}/settings?tab=config&env=production`);
  expect(row('正式版本').textContent).toContain('保存历史早于部署记录'); expect(row('正式版本').textContent).not.toContain('已有更新的配置');
  f.state.slotsFailure = true; await page.click('刷新版本对照'); expect(page.text()).toContain('部署槽读取失败');
  expect(page.text()).not.toContain('v1.0.0'); expect(page.text()).not.toContain('尚未部署');
});
