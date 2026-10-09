import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { renderApp } from './renderApp';
import { projectId, targetId, serviceId } from './releaseDeliveryFixture';
import { journeyId, releaseJourneyFixture, targetRevision } from './releaseJourneyFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); onlineManager.setOnline(true); });
function fixture() {
  const f = releaseJourneyFixture(), base = globalThis.fetch;
  const history = { visible: false };
  globalThis.fetch = (async (raw, init) => {
    if (String(raw).includes('/journey-history') && !history.visible) return Response.json({ journeys: [], trafficSwitches: [], slotEvents: [] });
    return base(raw, init);
  }) as typeof fetch;
  return { ...f, history };
}
const launch = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === '确认将 v1.1.0 上线');
async function check() { await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await page!.settle(); }

test('旧版本明确确认创建新的上线流程，在同一路由接续，不产生确认弹窗', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/release/versions/${targetId}`);
  expect(launch()?.disabled).toBe(true); await check(); await page.click('确认将 v1.1.0 上线');
  expect(f.writes).toHaveLength(1); expect(f.writes[0]?.path).toBe(`/v1/services/${serviceId}/traffic-switch`);
  expect(f.writes[0]?.body).toMatchObject({ expectedTargetRelease: targetId, expectedTargetRevision: targetRevision, toSlot: 'preview' });
  expect(page.path()).toBe(`/projects/${projectId}/release/journeys/${journeyId}`); expect(document.querySelectorAll('dialog')).toHaveLength(0);
});

test('旧版本目标变化需重新核对且重新勾选；离线不发送，明确拒绝保留操作页', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/release/versions/${targetId}`); await check();
  f.delivery.slots[1]!.targetRevision = 'd'.repeat(64); await page.reread();
  expect(launch()?.disabled).toBe(true); expect(page.text()).toContain('核对期间部署已变化');
  await page.click('重新核对'); expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  await check(); await act(async () => onlineManager.setOnline(false)); await page.click('确认将 v1.1.0 上线'); expect(f.writes).toHaveLength(0);
  await act(async () => onlineManager.setOnline(true)); f.delivery.failSwitch = true; await page.click('确认将 v1.1.0 上线');
  expect(page.text()).toContain('维护窗口已关闭'); expect(f.writes).toHaveLength(1); expect(launch()?.disabled).toBe(false);
});

test('旧版本上线回执丢失，刷新后只读取新流程，始终保持一次 POST', async () => {
  const f = fixture(); f.state.loseResponse = true; page = await renderApp(`/projects/${projectId}/release/versions/${targetId}`);
  await check(); await page.click('确认将 v1.1.0 上线'); expect(page.text()).toContain('结果尚未确认');
  page.unmount(); page = await renderApp(`/projects/${projectId}/release/versions/${targetId}`);
  expect(launch()).toBeUndefined(); expect(f.writes).toHaveLength(1); f.history.visible = true;
  await page.click('读取上线结果'); await page.click('继续发布'); expect(page.path()).toBe(`/projects/${projectId}/release/journeys/${journeyId}`);
  expect(f.writes).toHaveLength(1);
});

test('旧版本开发者保留历史读取与预览入口，由负责人继续正式上线', async () => {
  const f = fixture(); f.delivery.role = 'developer'; page = await renderApp(`/projects/${projectId}/release/versions/${targetId}`);
  expect(launch()?.disabled).toBe(true); expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
  expect(page.text()).toContain('由项目负责人或管理员'); expect(f.writes).toHaveLength(0);
});
