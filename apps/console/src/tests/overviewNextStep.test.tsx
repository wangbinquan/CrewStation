import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import type { ReleaseId } from '@crewstation/contracts';
import { renderApp } from './renderApp';
import { summaryFixture, summaryUserId } from './projectSummaryFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

const prodRelease = '01a0bf5d-8f4b-7574-87e3-e3a9645702f6' as ReleaseId, previewRelease = '01a0bf5d-8f4b-7645-8cca-c128d59001d1' as ReleaseId;
const slot = (name: 'prod' | 'preview', tag: string, releaseId: ReleaseId, host: string) => ({ name, active: name === 'prod', tag, commitSha: (name === 'prod' ? 'a' : 'b').repeat(40), releaseId, host, state: 'ready' as const, replicas: 1, readyReplicas: 1 });

test('概览的下一步横幅只从有效的槽与发布事实推导：待验证版本不同于正式版本才提示等待验证并直达该发布', async () => {
  const f = summaryFixture(), time = new Date().toISOString();
  f.item.slots = { status: 'ready', checkedAt: time, value: [slot('prod', 'v1.0.0', prodRelease, 'formal.test'), slot('preview', 'v1.0.1', previewRelease, 'trial.test')] };
  page = await renderApp(`/projects/${f.item.project.id}`);
  expect(page.text()).toContain('v1.0.1 已发布，等待验证');
  expect(document.querySelector(`a[href*="release=${previewRelease}"]`)?.textContent).toBe('查看版本');
  // 版本卡以标签为标题，副本与地址各一行；两处访问入口文字保持既有断言。
  expect(page.text()).toContain('1／1 副本就绪'); expect([...document.querySelectorAll('a[href="//trial.test"]')].map((node) => node.textContent)).toContain('打开试用');
  // 待验证与正式是同一发布：没有“等待验证”的下一步。
  f.item.slots.value[1] = { ...slot('preview', 'v1.0.0', prodRelease, 'trial.test') }; await page.click('刷新');
  expect(page.text()).not.toContain('等待验证');
  // 尚无正式版本但待验证就绪：提示首次上线，而不是把待命槽当作已上线。
  f.item.slots.value = [{ name: 'prod', active: true, state: 'empty', replicas: 0, readyReplicas: 0, host: 'formal.test' }, slot('preview', 'v1.0.1', previewRelease, 'trial.test')]; await page.click('刷新');
  expect(page.text()).toContain('v1.0.1 可试用，尚无正式版本'); expect(page.text()).toContain('尚未部署');
});

test('最新发布失败或进行中时横幅优先说明该发布；测试者不显示下一步', async () => {
  const f = summaryFixture(), time = new Date().toISOString();
  const release = (status: 'failed' | 'building') => ({ id: previewRelease, serviceId: f.item.project.serviceId!, tag: 'v1.0.2', commitSha: 'b'.repeat(40), branch: 'main', status, createdBy: summaryUserId, createdAt: time, updatedAt: time });
  f.item.slots = { status: 'ready', checkedAt: time, value: [slot('prod', 'v1.0.0', prodRelease, 'formal.test'), slot('preview', 'v1.0.1', previewRelease, 'trial.test')] };
  f.item.releases = { status: 'ready', checkedAt: time, value: [release('failed')] };
  page = await renderApp(`/projects/${f.item.project.id}`);
  expect(page.text()).toContain('v1.0.2 发布失败'); expect(page.text()).not.toContain('等待验证');
  f.item.releases.value = [release('building')]; await page.click('刷新');
  expect(page.text()).toContain('v1.0.2 正在发布');
  f.item.role = 'tester'; f.admin = false; await page.click('刷新');
  expect(page.text()).not.toContain('正在发布'); expect(page.text()).not.toContain('等待验证');
});
