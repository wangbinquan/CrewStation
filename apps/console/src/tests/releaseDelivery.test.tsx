import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { historyId, prodId, projectId, releaseDeliveryFixture, serviceId, targetId } from './releaseDeliveryFixture';
import { journeyId, releaseJourneyFixture, targetRevision } from './releaseJourneyFixture';
import { FakeEventSource, resourceRecord } from './resourceRecordFixture';

const originalFetch = globalThis.fetch, OriginalEventSource = globalThis.EventSource;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; globalThis.EventSource = OriginalEventSource; FakeEventSource.reset(); sessionStorage.clear(); });
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text);
const path = `/projects/${projectId}/release/journeys/${journeyId}`;

test('进行中的流程深链接不能把未执行的未来步骤显示成完成', async () => {
  const f = releaseJourneyFixture(); page = await renderApp(`${path}?step=4`);
  expect(document.querySelector('h2[tabindex]')?.textContent).toBe('验证版本');
  expect(button('验证通过，继续')).toBeDefined(); expect(f.writes).toHaveLength(0);
});

test('历史确认步骤分开显示当次目标、原确认人与前一版本，当前正式版本变化不改写原结果', async () => {
  const f = releaseJourneyFixture(); f.detail.status = 'succeeded';
  f.detail.trafficSwitch = { id: 'confirmed-operation', serviceId: serviceId as never, releaseId: targetId as never, previousReleaseId: prodId as never,
    fromSlot: 'preview', toSlot: 'prod', actorUserId: f.detail.snapshot.actorUserId, reason: '当次上线说明', createdAt: f.detail.snapshot.startedAt };
  f.delivery.slots[0] = { ...f.delivery.slots[0]!, releaseId: historyId as never, tag: 'v9.9.9' };
  page = await renderApp(`${path}?step=3`);
  for (const text of ['当前正式版本', 'v9.9.9', '本次目标版本', 'v1.1.0', '当次上线前的版本 ID', prodId, '上线确认人', '当次上线说明', '这次发布已确认正式生效']) expect(page.text()).toContain(text);
  expect(f.writes).toHaveLength(0); expect(button('确认将 v1.1.0 上线')).toBeUndefined();
});
async function verify() { await page!.click('验证通过，继续'); }

test('就绪自动进入验证，验证后同页显示双版本和明确上线确认；受理和实际完成分开', async () => {
  const f = releaseJourneyFixture(); page = await renderApp(path);
  expect(document.querySelector('h2[tabindex]')?.textContent).toBe('验证版本'); expect(document.querySelector<HTMLAnchorElement>('a[href="//preview.demo.cs.localhost"]')?.target).toBe('_blank');
  expect(button('确认将 v1.1.0 上线')).toBeUndefined(); await verify();
  expect(document.querySelector('h2[tabindex]')?.textContent).toBe('确认上线'); expect(page.text()).toContain('v1.0.0'); expect(page.text()).toContain('b'.repeat(40));
  await page.click('确认将 v1.1.0 上线');
  expect(f.writes[1]).toMatchObject({ path: `/v1/services/${serviceId}/traffic-switch`, body: { toSlot: 'preview', journeyId, expectedActiveRelease: prodId, expectedTargetRelease: targetId, expectedTargetRevision: targetRevision, requestKey: expect.any(String) } });
  expect(page.text()).toContain('正在确认正式路由实际生效'); expect(page.text()).not.toContain('已确认正式生效'); expect(document.querySelectorAll('dialog')).toHaveLength(0);
  f.detail.status = 'succeeded'; f.detail.stages.find(stage => stage.stage === 'complete')!.state = 'succeeded'; await page.reread();
  expect(page.text()).toContain('这次发布已确认正式生效'); expect(document.querySelector('h2[tabindex]')?.textContent).toBe('完成'); expect(f.writes).toHaveLength(2);
});

test('首次上线发送明确空正式版本，验证与上线是两次不同授权动作', async () => {
  const f = releaseJourneyFixture(); f.detail.continuation.expectedActiveReleaseId = null; f.delivery.slots[0] = { ...f.delivery.slots[0]!, releaseId: undefined, tag: undefined, commitSha: undefined, state: 'empty', replicas: 0, readyReplicas: 0 };
  page = await renderApp(path); await verify(); expect(f.writes).toHaveLength(1); await page.click('确认将 v1.1.0 上线'); expect(f.writes[1]!.body.expectedActiveRelease).toBeNull();
});

test('核对后正式版本或部署代次改变使确认失效，需要显式重新核对；读取失败也禁用写入', async () => {
  const f = releaseJourneyFixture(); page = await renderApp(path); await verify();
  f.detail.continuation.expectedActiveReleaseId = historyId as never; await page.reread(); expect(button('确认将 v1.1.0 上线')?.disabled).toBe(true);
  expect(page.text()).toContain('核对期间部署已变化'); await page.click('重新核对'); expect(button('确认将 v1.1.0 上线')?.disabled).toBe(false);
  f.state.readError = true; await page.reread(); expect(button('确认将 v1.1.0 上线')?.disabled).toBe(true); expect(f.writes).toHaveLength(1);
});

test('维护或迁移拒绝留在当前步骤说明原因，不自动重发', async () => {
  const f = releaseJourneyFixture(); f.delivery.failSwitch = true; page = await renderApp(path); await verify(); await page.click('确认将 v1.1.0 上线');
  expect(page.text()).toContain('维护窗口已关闭'); expect(page.path()).toBe(path); expect(f.writes).toHaveLength(2); await page.reread(); expect(f.writes).toHaveLength(2);
});

test('开发者可验证，但最后上线交给负责人；测试者和跨项目身份不能发请求', async () => {
  const f = releaseJourneyFixture(); f.delivery.role = 'developer'; page = await renderApp(path); await verify();
  expect(page.text()).toContain('由项目负责人或管理员完成最后确认'); expect(button('确认将 v1.1.0 上线')?.disabled).toBe(true); expect(page.text()).toContain('复制'); expect(f.writes).toHaveLength(1);
  page.unmount(); f.delivery.role = 'tester'; page = await renderApp(path); expect(button('验证通过，继续')).toBeUndefined(); expect(button('确认将 v1.1.0 上线')).toBeUndefined(); expect(f.writes).toHaveLength(1);
});

test('fenced 交接刷新后继续原流程，激活后仍等待完整生效确认，不重复切流', async () => {
  const f = releaseJourneyFixture(); f.delivery.controlled = true; page = await renderApp(path); await verify(); await page.click('确认将 v1.1.0 上线');
  expect(page.text()).toContain('正在冻结执行权'); expect(f.writes).toHaveLength(2);
  f.detail.trafficSwitch!.handoff = { stage: 'activating', message: '等待实际应用接管' }; page.unmount(); page = await renderApp(path);
  expect(page.text()).toContain('交接尚未完成'); expect(button('确认将 v1.1.0 上线')).toBeUndefined(); expect(f.writes).toHaveLength(2);
  f.detail.trafficSwitch!.handoff = { stage: 'complete' }; await page.reread(); expect(page.text()).not.toContain('这次发布已确认正式生效');
  f.detail.status = 'succeeded'; await page.reread(); expect(page.text()).toContain('这次发布已确认正式生效');
});

test('响应丢失只读恢复，重复点击与刷新不能重复发出上线请求', async () => {
  const f = releaseJourneyFixture(); f.state.loseResponse = true; page = await renderApp(path); await verify();
  await act(async () => { button('确认将 v1.1.0 上线')!.click(); button('确认将 v1.1.0 上线')!.click(); }); await page.settle();
  expect(f.writes).toHaveLength(2); page.unmount(); page = await renderApp(path); expect(button('确认将 v1.1.0 上线')).toBeUndefined(); expect(f.writes).toHaveLength(2);
});

test('总览上线入口直接继续此版本当前向导，历史版本详情仍是精确独立路由', async () => {
  const f = releaseJourneyFixture(); page = await renderApp(`/projects/${projectId}/release`); await page.click('上线 v1.1.0');
  await page.settle(); expect(page.path()).toBe(path); expect(f.writes).toHaveLength(0);
  await page.navigate(`/projects/${projectId}/release?release=${historyId}`); expect(page.path()).toBe(`/projects/${projectId}/release/versions/${historyId}`); expect(page.text()).toContain('未记录'); expect(f.writes).toHaveLength(0);
});

test('无副本、身份未知和其他发布进行中保持实际卡片可读但不能发起上线', async () => {
  const f = releaseDeliveryFixture(); f.state.slots[1]!.readyReplicas = 0; page = await renderApp(`/projects/${projectId}/release`);
  expect(button('上线 v1.1.0')?.disabled).toBe(true); expect(f.writes).toHaveLength(0);
  f.state.slots[1]!.readyReplicas = 1; f.releases[2]!.status = 'building'; await page.reread(); expect(button('上线 v1.1.0')?.disabled).toBe(true);
  await page.click('查看进行中的发布'); expect(page.path()).toBe(`/projects/${projectId}/release/versions/${historyId}`);
});
test('槽卡随资源推送流更新：服务槽记录变了重读一次部署记录，别的记录变化不重读', async () => {
  const f = releaseDeliveryFixture();
  const slotRecord = resourceRecord({ id: '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ef31', kind: 'service-slot', owner: { module: 'release', ref: `${serviceId}/green` }, display: { physical: 'green', role: 'preview', tag: 'v1.1.0' } });
  const workspace = resourceRecord({ id: '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ef32' });
  f.state.records = [slotRecord, workspace];
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  page = await renderApp(`/projects/${projectId}/release`);
  const slotReads = () => f.reads.filter((path) => path === `/v1/services/${serviceId}/slots`).length;
  const before = slotReads();
  expect(before).toBeGreaterThan(0); expect(page.text()).toContain('b'.repeat(40));
  const stream = FakeEventSource.opened.find((source) => source.url.startsWith(`/v1/projects/${projectId}/resources/stream`))!;
  await act(async () => { stream.emit({ type: 'upsert', record: { ...workspace, version: 2 }, counts: {}, cursor: 2 }); await Bun.sleep(20); });
  await page.settle();
  expect(slotReads()).toBe(before);
  // 待验证槽副本崩溃：记录变了，槽的 DTO 重读一次，卡片照新读的写。
  f.state.slots[1] = { ...f.state.slots[1]!, state: 'degraded', readyReplicas: 0 };
  await act(async () => { stream.emit({ type: 'upsert', record: { ...slotRecord, phase: 'degraded', version: 2 }, counts: {}, cursor: 3 }); await Bun.sleep(20); });
  await page.settle();
  expect(slotReads()).toBe(before + 1);
  expect(page.text()).toContain('副本不足'); expect(page.text()).toContain('0／1 副本就绪');
});
