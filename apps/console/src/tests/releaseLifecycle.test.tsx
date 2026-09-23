import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { at, oldId, projectId, serviceId, slotLifecycleFixture, standbyId } from './slotLifecycleFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === label);
async function click(label: string) { expect(button(label)).toBeDefined(); await act(async () => button(label)!.click()); await page!.settle(); }
const previewCard = () => [...document.querySelectorAll('section')].find((node) => node.querySelector('h2')?.textContent === '待验证版本')?.textContent ?? '';

// RFC-021 M2、M19、M23、B3：待验证卡写明何时因何自动下线，提醒之后负责人可以推迟一个周期；请求带上看到的到期时间。
test('负责人看到回退保留期的到期时间与提醒，推迟 72 小时下线带确认值；推迟后按钮消失到下一次提醒', async () => {
  const f = slotLifecycleFixture(); page = await renderApp(`/projects/${projectId}/release`);
  expect(previewCard()).toContain('作为回退目标保留到'); expect(previewCard()).toContain('之后自动下线'); expect(previewCard()).toContain('提醒负责人');
  await click('推迟 72 小时下线');
  expect(f.writes).toEqual([{ method: 'POST', path: `/v1/services/${serviceId}/slots/preview/postpone`, body: { expectedDeadline: at(74) } }]);
  expect(page.text()).toContain('已推迟：v1.0.0 改为'); expect(f.state.slots[1]!.retention?.postponements).toBe(1);
  expect(page.text()).toContain('负责人 把 v1.0.0 的自动下线推迟到');
  expect(button('推迟 72 小时下线')).toBeUndefined(); expect(button('下线')).toBeDefined();
});

// 2026-09-23 裁定：「推迟」只在服务端说能推迟（为当前到期时间发过提醒）时出现，不再一直可点；无人访问的期限按天写。
test('提醒发出之前没有推迟按钮，下线照常；无人访问的待验证版本提醒后是「推迟 14 天下线」', async () => {
  const f = slotLifecycleFixture(), preview = f.state.slots[1]!;
  f.state.slots[1] = { ...preview, retention: { kind: 'rollback-target', since: at(2), deadline: at(74), postponable: false, postponements: 0, periodHours: 72 } };
  page = await renderApp(`/projects/${projectId}/release`);
  expect(previewCard()).toContain('之后自动下线'); expect(previewCard()).not.toContain('提醒负责人');
  expect([...document.querySelectorAll('button')].some((node) => node.textContent?.startsWith('推迟'))).toBe(false); expect(button('下线')).toBeDefined();
  f.state.slots[1] = { ...preview, retention: { kind: 'pending', since: at(2), deadline: at(338), remindedAt: at(314), postponable: true, postponements: 0, periodHours: 336 } };
  await page.reread();
  expect(previewCard()).toContain('前仍无人访问将自动下线'); expect(button('推迟 14 天下线')).toBeDefined();
  expect(f.writes).toHaveLength(0);
});

// M1、M5、B6：下线不可恢复，要两段确认；下线后卡上写明何时因何下线，并给出把它重新部署回来的入口（不重新构建）。
test('下线要行内确认；下线后卡片显示已下线并能重新部署回来，确认面板写明待命槽为空', async () => {
  const f = slotLifecycleFixture(); page = await renderApp(`/projects/${projectId}/release`);
  await click('下线'); expect(page.text()).toContain('下线会删除 v1.0.0 的工作负载，不能撤销'); expect(f.writes).toHaveLength(0);
  await click('确认下线 v1.0.0');
  expect(f.writes).toEqual([{ method: 'POST', path: `/v1/services/${serviceId}/slots/preview/offline`, body: { expectedReleaseId: standbyId } }]);
  expect(page.text()).toContain('v1.0.0 已下线：工作负载已删除');
  expect(previewCard()).toContain('已下线'); expect(previewCard()).toContain('负责人手动下线'); expect(button('上线 v1.0.0')).toBeUndefined();
  expect(document.querySelector('a[href="//preview.demo.cs.localhost"]')).toBeNull();
  expect(page.text()).toContain('负责人 下线了 v1.0.0');
  await click('重新部署 v1.0.0'); expect(page.text()).toContain('把 v1.0.0 重新部署到待验证版本？'); expect(page.text()).toContain('空（当前没有待验证版本）'); expect(page.text()).toContain('不重新构建、不重跑迁移');
  await click('确认重新部署 v1.0.0');
  expect(f.writes[1]).toEqual({ method: 'POST', path: `/v1/releases/${standbyId}/redeploy`, body: { expectedStandbyReleaseId: null } });
  expect(page.text()).toContain('已受理重新部署 v1.0.0'); expect(page.text()).not.toContain('把 v1.0.0 重新部署到待验证版本？');
});

// M5、M10：发布记录里可以重新部署的版本带「重新部署」；确认面板写明会替换待命槽上的哪个版本，请求带上它。
test('从发布记录重新部署较早的版本：写明替换待命版本，取消不发请求，确认带上待命版本', async () => {
  const f = slotLifecycleFixture(); page = await renderApp(`/projects/${projectId}/release`);
  const timelineButtons = () => [...document.querySelectorAll<HTMLButtonElement>('ul button')].filter((node) => node.textContent === '重新部署');
  expect(timelineButtons()).toHaveLength(1);
  await act(async () => timelineButtons()[0]!.click()); await page.settle();
  expect(page.text()).toContain('把 v0.9.0 重新部署到待验证版本？'); expect(page.text()).toContain('v1.0.0（会被替换并下线）');
  await click('取消'); expect(page.text()).not.toContain('把 v0.9.0 重新部署到待验证版本？'); expect(f.writes).toHaveLength(0);
  await page.navigate(`/projects/${projectId}/release?release=${oldId}`); await click('重新部署到待验证版本'); await click('确认重新部署 v0.9.0');
  expect(f.writes).toEqual([{ method: 'POST', path: `/v1/releases/${oldId}/redeploy`, body: { expectedStandbyReleaseId: standbyId } }]);
});

// M8、M10：开发者看得到到期提示，但没有推迟、下线、重新部署与进入维护。
test('开发者只看到到期提示，没有任何生命周期动作', async () => {
  slotLifecycleFixture('developer'); page = await renderApp(`/projects/${projectId}/release`);
  expect(previewCard()).toContain('之后自动下线');
  for (const label of ['推迟 72 小时下线', '下线', '进入维护', '重新部署']) expect(button(label)).toBeUndefined();
});

// B3：别人先推迟或替换过时服务端拒绝；页面说明原因并重读槽，不自动重发。
test('推迟被拒绝时显示服务端原因，只发一次', async () => {
  const f = slotLifecycleFixture(); f.state.fail = { status: 409, message: '到期时间已经变化，请刷新后重新确认' };
  page = await renderApp(`/projects/${projectId}/release`);
  await click('推迟 72 小时下线'); expect(page.text()).toContain('到期时间已经变化，请刷新后重新确认'); expect(f.writes).toHaveLength(1);
  expect(button('推迟 72 小时下线')?.disabled).toBe(false);
});

// M9：平台管理员对任意项目与负责人同权。
test('平台管理员不是成员也能推迟、下线与进入维护', async () => {
  slotLifecycleFixture('developer', true); page = await renderApp(`/projects/${projectId}/release`);
  for (const label of ['推迟 72 小时下线', '下线', '进入维护']) expect(button(label)).toBeDefined();
});
