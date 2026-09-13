import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { renderElement } from './renderElement';
import { DeploymentVersions } from '../features/release/components/DeploymentVersions';
import { messages } from '../features/release/i18n/zh-CN';
import { useReleaseActions } from '../features/release/model/useReleaseActions';
import { useApiQuery } from '../shared/api/useApi';
import { queryKeys } from '../shared/api/queryKeys';
import { historyId, prodId, projectId, releaseDeliveryFixture, serviceId, targetId } from './releaseDeliveryFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === label);
async function click(label: string) { expect(button(label)).toBeDefined(); await act(async () => button(label)!.click()); await page!.settle(); }
async function input(name: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!; expect(field).toBeDefined();
  const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { field.focus(); Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
}
const check = () => click('检查上线／回退至 v1.1.0');

test('并列真实部署与完整 SHA，具名确认双版本；首次上线显式发送空正式版本', async () => {
  const f = releaseDeliveryFixture(); f.state.slots[0] = { ...f.state.slots[0]!, releaseId: undefined, tag: undefined, commitSha: undefined, state: 'empty', replicas: 0, readyReplicas: 0 };
  page = await renderApp(`/projects/${projectId}/release`);
  expect(page.text()).toContain('待验证版本'); expect(page.text()).toContain('b'.repeat(40)); expect(page.text()).toContain('试用也可能写入生产数据');
  expect(document.querySelector<HTMLAnchorElement>('a[href="//preview.demo.cs.localhost"]')?.textContent).toBe('试用待验证版本');
  expect(document.querySelector('a[href="//demo.cs.localhost"]')).toBeNull();
  await check(); expect(page.text()).toContain('正式版本 尚未部署 → v1.1.0'); expect(f.writes).toHaveLength(0);
  await click('确认上线 v1.1.0'); expect(f.writes).toEqual([{ path: `/v1/services/${serviceId}/traffic-switch`, body: { toSlot: 'preview', expectedActiveRelease: null, expectedTargetRelease: targetId } }]);
  expect(page.text()).toContain('已登记正式版本切换到 v1.1.0'); expect(page.text()).toContain('网关异步应用');
});

test('负责人回退仅指向仍部署的较旧发布；迁移拒绝保留说明，不自动重发或选历史记录', async () => {
  const f = releaseDeliveryFixture(); f.releases[1]!.createdAt = '2026-09-12T01:00:00.000Z'; f.state.failSwitch = true;
  page = await renderApp(`/projects/${projectId}/release?release=${historyId}`);
  await check(); expect(page.text()).toContain('回退只切换流量，不恢复生产数据'); await input('trafficReason', '接口回归，回退验证');
  await click('确认回退至 v1.1.0'); expect(f.writes[0]?.body).toMatchObject({ expectedActiveRelease: prodId, expectedTargetRelease: targetId, reason: '接口回归，回退验证' });
  expect(page.text()).toContain('破坏性迁移'); expect(page.text()).toContain('请发布修复版本'); expect(document.querySelector<HTMLTextAreaElement>('[name="trafficReason"]')?.value).toBe('接口回归，回退验证');
  expect(button('确认回退至 v1.1.0')).toBeUndefined(); await page.settle(); expect(f.writes).toHaveLength(1);
  expect(page.search().release).toBe(historyId);
});

test('已确认目标被替换或读取失败时确认失效，重新核对才接受新目标', async () => {
  const f = releaseDeliveryFixture(); page = await renderApp(`/projects/${projectId}/release`); await check();
  f.state.failSlots = true; await click('刷新部署版本'); expect(page.text()).toContain('确认后的部署已变化或无法读取'); expect(button('确认上线 v1.1.0')?.disabled).toBe(true);
  expect(document.querySelector('a[href="//preview.demo.cs.localhost"]')).toBeNull();
  f.state.failSlots = false; f.state.slots[1] = { ...f.state.slots[1]!, releaseId: f.releases[2]!.id, tag: 'v0.9.0', commitSha: 'c'.repeat(40) }; await click('刷新部署版本');
  expect(button('确认上线 v1.1.0')?.disabled).toBe(true); expect(f.writes).toHaveLength(0);
  await click('重新核对两个版本'); expect(page.text()).toContain('正式版本 v1.0.0 → v0.9.0'); await click('确认回退至 v0.9.0'); expect(f.writes[0]?.body.expectedTargetRelease).toBe(historyId);
});

test('说明约束、错误焦点、取消与单次离开确认；发布草稿和切换草稿都保留', async () => {
  const f = releaseDeliveryFixture(); page = await renderApp(`/projects/${projectId}/release?source=repository`);
  await click('检查发布来源'); await click('确认版本'); await input('message', '候选发布说明');
  await check(); expect(page.text()).toContain('可选，最多 500 字'); await input('trafficReason', '字'.repeat(501)); await click('确认上线 v1.1.0');
  expect(document.activeElement?.getAttribute('name')).toBe('trafficReason'); expect(document.querySelector('[name="trafficReason"]')?.getAttribute('aria-invalid')).toBe('true'); expect(f.writes).toHaveLength(0);
  await input('trafficReason', '保留切换说明'); await click('取消切换'); expect(document.querySelector<HTMLTextAreaElement>('[name="trafficReason"]')?.value).toBe('保留切换说明');
  await page.requestNavigate(`/projects/${projectId}`); expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1); await click('继续编辑');
  expect(document.querySelector<HTMLTextAreaElement>('[name="message"]')?.value).toBe('候选发布说明'); expect(document.querySelector<HTMLTextAreaElement>('[name="trafficReason"]')?.value).toBe('保留切换说明');
  await click('收起准备'); await click('放弃输入并离开'); expect(page.search().source).toBeUndefined(); expect(document.querySelector<HTMLTextAreaElement>('[name="trafficReason"]')?.value).toBe('保留切换说明');
});

test('在途切换只发一次并阻止另一发布；离开后的回执不跨项目导航', async () => {
  const f = releaseDeliveryFixture(); page = await renderApp(`/projects/${projectId}/release?source=repository`);
  await click('检查发布来源'); await click('确认版本'); await check();
  let resolve!: () => void; f.state.hold = new Promise<void>((done) => { resolve = done; });
  await act(async () => { button('确认上线 v1.1.0')!.click(); button('确认上线 v1.1.0')!.click(); document.querySelector('form[aria-label="发布准备"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await page.settle();
  expect(f.writes).toHaveLength(1); expect(button('确认发布到待验证版本')?.disabled).toBe(true);
  await page.requestNavigate(`/projects/${projectId}`); await click('放弃输入并离开'); await act(async () => resolve()); await page.settle(); expect(page.path()).toBe(`/projects/${projectId}`);
});

test('重复发布在途阻止切换；受理发布后保留切换说明且无需第二次离开确认', async () => {
  const f = releaseDeliveryFixture(); page = await renderApp(`/projects/${projectId}/release?source=repository`);
  await check(); await input('trafficReason', '试用确认后上线'); await click('取消切换'); await click('检查发布来源'); await click('确认版本');
  let resolve!: () => void; f.state.hold = new Promise<void>((done) => { resolve = done; });
  await click('确认发布到待验证版本'); expect(button('检查上线／回退至 v1.1.0')?.disabled).toBe(true); await act(async () => resolve()); await page.settle();
  expect(page.search().release).toBe(targetId); expect(page.search().source).toBeUndefined(); expect(document.querySelector<HTMLTextAreaElement>('[name="trafficReason"]')?.value).toBe('试用确认后上线'); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

test('错误发布身份、未知槽与无副本都不可试用或切换；错误回执不显示成功', async () => {
  const f = releaseDeliveryFixture(); page = await renderApp(`/projects/${projectId}/release`); f.state.badRelease = true; await check(); expect(page.text()).toContain('部署记录与发布身份不一致'); expect(button('确认上线 v1.1.0')).toBeUndefined();
  f.state.badRelease = false; f.state.slots[1]!.readyReplicas = 0; await click('刷新部署版本'); expect(button('检查上线／回退至 v1.1.0')?.disabled).toBe(true); expect(document.querySelector('a[href="//preview.demo.cs.localhost"]')).toBeNull();
  f.state.slots[1]!.readyReplicas = 1; await click('刷新部署版本'); await check(); f.state.mismatch = true; await click('确认上线 v1.1.0'); expect(page.text()).toContain('返回的切换对象无法确认'); expect(page.text()).not.toContain('已登记正式版本切换');
});

test('开发者可准备发布但无切换按钮，测试者无发布权；管理员保持管理空间，概览不再重复切流', async () => {
  const f = releaseDeliveryFixture(); f.state.role = 'developer'; page = await renderApp(`/projects/${projectId}/release`); expect(button('准备发布')?.disabled).toBe(false); expect(button('检查上线／回退至 v1.1.0')).toBeUndefined();
  page.unmount(); f.state.role = 'tester'; page = await renderApp(`/projects/${projectId}/release`); expect(button('准备发布')?.disabled).toBe(true); expect(button('检查上线／回退至 v1.1.0')).toBeUndefined();
  page.unmount(); f.state.admin = true; page = await renderApp(`/admin/integrations/${projectId}/release`); await check(); await click('取消切换'); await click('v1.1.0'); expect(page.path()).toBe(`/admin/integrations/${projectId}/release`); expect(page.search().release).toBe(targetId);
  await page.navigate(`/admin/integrations/${projectId}`); expect(page.text()).not.toContain('将用户流量切'); expect(button('检查上线／回退至 v1.1.0')).toBeUndefined();
});

test('切流受理后工作树对正式版本的比较与详情重新读取', async () => {
  releaseDeliveryFixture(); const reads = { comparison: 0, details: 0 };
  function ComparisonWithDelivery() {
    const actions = useReleaseActions();
    useApiQuery(queryKeys.versionComparison(projectId, 'task-example'), async () => { reads.comparison += 1; return { production: prodId }; });
    useApiQuery(queryKeys.comparisonDetails(projectId, 'comparison-example', 'net'), async () => { reads.details += 1; return { files: [] }; });
    return <DeploymentVersions projectId={projectId} serviceId={serviceId} canSwitch actions={actions} onSelect={() => {}} />;
  }
  const ui = await renderElement(<ComparisonWithDelivery />, messages);
  try {
    await ui.click('检查上线／回退至 v1.1.0'); const before = { ...reads };
    await ui.click('确认上线 v1.1.0'); expect(reads.comparison).toBeGreaterThan(before.comparison); expect(reads.details).toBeGreaterThan(before.details);
  } finally { ui.unmount(); }
});

test('其他发布进行中保留当前部署信息并阻止切换，可精确定位该发布', async () => {
  const f = releaseDeliveryFixture(); f.releases[2]!.status = 'building';
  page = await renderApp(`/projects/${projectId}/release`);
  expect(page.text()).toContain('发布 v0.9.0 正在进行'); expect(button('检查上线／回退至 v1.1.0')?.disabled).toBe(true);
  await click('查看进行中的发布'); expect(page.search().release).toBe(historyId); expect(f.writes).toHaveLength(0);
});
