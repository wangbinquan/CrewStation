import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { renderApp } from './renderApp';
import { summaryFixture } from './projectSummaryFixture';
import type { ReleaseId } from '@crewstation/contracts';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
function fixture() {
  const f = summaryFixture(), checkedAt = new Date().toISOString(); f.admin = false; f.projectDenied = true; f.item.role = 'tester';
  f.item.development = f.item.slots = f.item.health = f.item.releases = f.item.switches = { status: 'restricted', checkedAt };
  f.item.preview = { status: 'ready', checkedAt, value: { name: 'preview', active: false, state: 'ready', replicas: 1, readyReplicas: 1,
    host: 'preview.demo.test', releaseId: `rel_${'b'.repeat(32)}` as ReleaseId, tag: 'v1.0.1', commitSha: 'b'.repeat(40) } };
  return f;
}

test('测试者由列表进入试用详情，无权项目接口和开发／配置页面不挂载', async () => {
  const f = fixture(); page = await renderApp('/projects');
  // 真实测试者列表无试用入口，点击项目名又只得到角色 view 拒绝。
  expect(document.querySelector('a[href="//preview.demo.test"]')?.textContent).toBe('打开试用');
  await page.click('数字助手 1'); expect(page.text()).toContain('v1.0.1'); expect(page.text()).toContain('共享生产数据');
  expect(page.text()).toContain('你是此项目的测试者');
  expect(document.querySelector('[aria-label="项目页面"]')?.textContent).toBe('版本试用');
  expect(f.calls.some((url) => url === `/v1/projects/${f.item.project.id}` || /\/dev-session|\/config\/|\/health/.test(url))).toBe(false);
  await page.navigate(`/projects/${f.item.project.id}/settings?tab=config`);
  expect(page.text()).toContain('你是此项目的测试者'); expect(f.calls.some((url) => /\/config\//.test(url))).toBe(false);
  expect(f.writes).toEqual([]);
});

test('试用读取失败、未部署与未就绪不提供旧链接；刷新恢复可用', async () => {
  const f = fixture(); page = await renderApp(`/projects/${f.item.project.id}`);
  const ready = f.item.preview!;
  expect(document.querySelector('a[href="//preview.demo.test"]') !== null).toBe(true);
  f.error = true; await page.click('重新检查'); expect(page.text()).toContain('摘要读取失败');
  expect(document.querySelector('a[href="//preview.demo.test"]') === null).toBe(true);
  f.error = false;
  if (ready.status !== 'ready' || !ready.value) throw new Error('missing fixture preview');
  f.item.preview = { ...ready, value: { ...ready.value, state: 'deploying', readyReplicas: 0 } };
  await page.click('重新检查'); expect(page.text()).toContain('部署中');
  expect(document.querySelector('a[href="//preview.demo.test"]') === null).toBe(true);
  f.item.preview = { status: 'ready', value: null, checkedAt: new Date().toISOString() };
  await page.click('重新检查'); expect(page.text()).toContain('尚未部署');
  expect(document.querySelector('a[href="//preview.demo.test"]') === null).toBe(true);
  f.item.preview = ready; await page.click('重新检查');
  expect(document.querySelector('a[href="//preview.demo.test"]') !== null).toBe(true);
});
