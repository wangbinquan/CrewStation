import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { renderApp } from './renderApp';
import { projectId, serviceId } from './releaseDeliveryFixture';
import { journeyId, releaseJourneyFixture, taskId } from './releaseJourneyFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); onlineManager.setOnline(true); });
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
async function input(name: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
  expect(field).toBeDefined();
  await act(async () => { field.focus(); Object.getOwnPropertyDescriptor(field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}

test('新发布使用独立五步路由，完整 SHA 和确定版本一次确认受理后自动接续，零弹窗', async () => {
  const f = releaseJourneyFixture(); page = await renderApp(`/projects/${projectId}/release`);
  await page.click('准备发布'); expect(page.path()).toBe(`/projects/${projectId}/release/publish`);
  expect(page.text()).toContain('a'.repeat(40)); expect(page.text()).toContain('v1.1.1'); expect(page.text()).toContain('生产数据');
  expect(document.querySelectorAll('dialog')).toHaveLength(0); expect(f.writes).toHaveLength(0);
  await page.click('开始构建与部署');
  expect(f.writes).toEqual([{ path: `/v1/services/${serviceId}/releases`, body: { branch: 'main', version: 'v1.1.1', expectedCommitSha: 'a'.repeat(40) } }]);
  expect(page.path()).toBe(`/projects/${projectId}/release/journeys/${journeyId}`); expect(document.querySelector('h2[tabindex]')?.textContent).toBe('构建与部署');
  expect(page.text()).not.toContain('已确认正式生效'); expect(document.querySelectorAll('dialog')).toHaveLength(0);
});

test('开发会话来源展示真实 dirty 文件，干净后提交精确任务、SHA、版本和说明；拒绝后保留草稿', async () => {
  const f = releaseJourneyFixture(); f.state.dirty = true; page = await renderApp(`/projects/${projectId}/release?source=session`);
  expect(page.path()).toBe(`/projects/${projectId}/release/publish`); expect(page.text()).toContain('未提交.ts'); expect(button('开始构建与部署').disabled).toBe(true);
  f.state.dirty = false; await page.reread(); expect(page.text()).toContain(taskId);
  await input('version', 'v2.3.4'); await input('message', '验证开发页'); f.state.publishError = 412; await page.click('开始构建与部署');
  expect(f.writes[0]).toEqual({ path: `/v1/projects/${projectId}/publish`, body: { branch: 'main', version: 'v2.3.4', expectedCommitSha: 'a'.repeat(40), expectedTaskId: taskId, message: '验证开发页' } });
  expect(page.text()).toContain('HEAD 已变化'); expect(document.querySelector<HTMLInputElement>('[name="version"]')?.value).toBe('v2.3.4');
  expect(f.writes).toHaveLength(1); await page.click('已推送分支'); expect(document.querySelector<HTMLTextAreaElement>('[name="message"]')?.value).toBe('验证开发页');
});

test('准备草稿在稍后继续、刷新后恢复，项目/来源/用户隔离；明确清空才删除', async () => {
  releaseJourneyFixture(); page = await renderApp(`/projects/${projectId}/release/publish?source=repository`);
  await input('message', '稍后发布'); await input('version', 'v4.0.0'); await page.click('稍后继续');
  expect(document.querySelectorAll('dialog')).toHaveLength(0); await page.click('准备发布');
  expect(document.querySelector<HTMLTextAreaElement>('[name="message"]')?.value).toBe('稍后发布');
  page.unmount(); page = await renderApp(`/projects/${projectId}/release/publish?source=repository`);
  expect(document.querySelector<HTMLInputElement>('[name="version"]')?.value).toBe('v4.0.0'); await page.click('清空准备草稿');
  expect(document.querySelector<HTMLTextAreaElement>('[name="message"]')?.value).toBe('');
});

test('已发送未知结果在刷新后只读核对，精确定位原流程，不重复 POST', async () => {
  const f = releaseJourneyFixture(); f.state.loseResponse = true; page = await renderApp(`/projects/${projectId}/release/publish`);
  await page.click('开始构建与部署'); expect(page.text()).toContain('响应连接中断'); expect(f.writes).toHaveLength(1);
  page.unmount(); page = await renderApp(`/projects/${projectId}/release/publish`);
  expect(page.text()).toContain('已发出 v1.1.1'); expect(button('开始构建与部署')).toBeUndefined();
  await page.click('核对已受理的发布'); expect(page.path()).toBe(`/projects/${projectId}/release/journeys/${journeyId}`); expect(f.writes).toHaveLength(1);
  expect(f.reads.some(path => path.includes('tag=v1.1.1'))).toBe(true);
});

test('服务端明确拒绝的版本冲突保留草稿并允许修改，不困在未知回执状态', async () => {
  const f = releaseJourneyFixture(); f.state.publishError = 409; page = await renderApp(`/projects/${projectId}/release/publish`);
  await input('message', '保留说明'); await page.click('开始构建与部署'); expect(f.writes).toHaveLength(1);
  expect(button('核对已受理的发布')).toBeUndefined(); expect(button('开始构建与部署').disabled).toBe(false);
  f.state.publishError = 0; await input('version', 'v4.5.6'); await page.click('开始构建与部署');
  expect(f.writes[1]?.body).toMatchObject({ version: 'v4.5.6', message: '保留说明' }); expect(page.path()).toBe(`/projects/${projectId}/release/journeys/${journeyId}`);
});

test('受理成功之后的读取限流不能清除发送意图或允许再次发布', async () => {
  const f = releaseJourneyFixture(), base = globalThis.fetch; let denyRead = true;
  globalThis.fetch = (async (raw, init) => String(raw).includes(`/release-journeys/${journeyId}`) && denyRead
    ? Response.json({ error: 'rate_limit', message: '读取暂时限流' }, { status: 429 }) : base(raw, init)) as typeof fetch;
  page = await renderApp(`/projects/${projectId}/release/publish`); await page.click('开始构建与部署');
  expect(button('开始构建与部署')).toBeUndefined(); expect(page.text()).toContain('读取暂时限流'); expect(f.writes).toHaveLength(1);
  denyRead = false; await page.click('核对已受理的发布'); expect(page.path()).toBe(`/projects/${projectId}/release/journeys/${journeyId}`); expect(f.writes).toHaveLength(1);
});

test('错配回执不能标受理，离开后的成功回执不会拉回；离线请求不发送', async () => {
  const f = releaseJourneyFixture(); page = await renderApp(`/projects/${projectId}/release/publish`);
  await act(async () => onlineManager.setOnline(false)); await page.click('开始构建与部署'); expect(f.writes).toHaveLength(0);
  await act(async () => onlineManager.setOnline(true));
  let resolve: () => void; f.delivery.hold = new Promise<void>(done => { resolve = done; });
  await act(async () => { button('开始构建与部署').click(); button('开始构建与部署')?.click(); }); await page.settle(); expect(f.writes).toHaveLength(1);
  await page.click('稍后继续'); await act(async () => resolve!()); await page.settle(); expect(page.path()).toBe(`/projects/${projectId}/release`);
  await page.click('准备发布'); await page.click('核对已受理的发布'); expect(f.writes).toHaveLength(1);
});

test('错误服务回执、重复标签、来源不可读和没有权限都不能悄悄更换意图或发送', async () => {
  const f = releaseJourneyFixture(); page = await renderApp(`/projects/${projectId}/release/publish`);
  await input('version', 'v1.1.0'); await page.click('开始构建与部署'); expect(page.text()).toContain('该标签已存在'); expect(f.writes).toHaveLength(0);
  await input('version', 'v1.1.1'); f.state.responseMismatch = true; await page.click('开始构建与部署');
  expect(page.text()).toContain('返回的服务或提交无法确认'); expect(page.path()).toBe(`/projects/${projectId}/release/publish`); expect(f.writes).toHaveLength(1);
  page.unmount(); sessionStorage.clear(); f.delivery.role = 'tester'; page = await renderApp(`/projects/${projectId}/release/publish`); expect(f.writes).toHaveLength(1); expect(button('开始构建与部署')).toBeUndefined();
});

test.each(['repository', 'session'])('管理空间 %s 准备/受理保持在同一空间', async source => {
  const f = releaseJourneyFixture(); f.delivery.admin = true; page = await renderApp(`/admin/integrations/${projectId}/release/publish?source=${source}`);
  await page.click('开始构建与部署'); expect(page.path()).toBe(`/admin/integrations/${projectId}/release/journeys/${journeyId}`); expect(f.writes).toHaveLength(1);
});


test('版本格式和超长说明在字段旁解释禁用原因，改正后可继续且不会提前发送', async () => {
  const f = releaseJourneyFixture(); page = await renderApp(`/projects/${projectId}/release/publish`);
  await input('version', 'invalid'); expect(button('开始构建与部署').disabled).toBe(true);
  expect(document.querySelector('[name="version"]')?.getAttribute('aria-describedby')).toBe('release-version-error');
  expect(document.getElementById('release-version-error')?.textContent).toContain('版本必须是');
  await input('version', 'v4.2.1'); await input('message', '文'.repeat(501));
  expect(button('开始构建与部署').disabled).toBe(true); expect(page.text()).toContain('发布说明不能超过 500 字');
  expect(f.writes).toHaveLength(0); await input('message', '已检查'); expect(button('开始构建与部署').disabled).toBe(false);
});
