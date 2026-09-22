import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { renderApp } from './renderApp';
import { historyId, prodId, projectId, releaseDeliveryFixture, serviceId, targetId, userId } from './releaseDeliveryFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const other = '01a0bf5d-8f4b-7222-8222-222222222222', gone = '01a0bf5d-8f4b-7111-8111-111111111111', unknownRelease = '01a0bf5d-8f4b-7000-8000-000000000000';
function withTimeline(options: { readonly switchesFail?: boolean; readonly membersFail?: boolean } = {}) {
  const f = releaseDeliveryFixture(), base = globalThis.fetch;
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname;
    if (path.endsWith('/traffic-switches')) return options.switchesFail ? Response.json({ error: 'unavailable', message: '切流服务不可用' }, { status: 503 }) : Response.json({ items: [
      { id: 'sw-1', serviceId, fromSlot: 'preview', toSlot: 'prod', releaseId: prodId, previousReleaseId: historyId, actorUserId: other, reason: '验收通过', createdAt: '2026-09-13T01:30:00.000Z' },
      { id: 'sw-2', serviceId, fromSlot: 'preview', toSlot: 'prod', releaseId: unknownRelease, previousReleaseId: prodId, actorUserId: gone, createdAt: '2026-09-13T01:40:00.000Z' },
    ] });
    if (path.endsWith('/members')) return options.membersFail ? Response.json({ error: 'forbidden', message: '无权读取成员' }, { status: 403 }) : Response.json({ items: [{ userId, role: 'owner', name: '负责人', email: 'owner@test.invalid' }, { userId: other, role: 'developer', name: '开发者小王', email: 'dev@test.invalid' }] });
    return base(raw, init);
  }) as typeof fetch;
  return f;
}
const rows = () => [...document.querySelectorAll('ul[aria-label="发布记录"] li')].map((node) => node.textContent ?? '');

test('发布页时间线合并发布与切流：倒序、人名与标签代替 UUID、失败条目有构建日志入口、标签可选中详情', async () => {
  const f = withTimeline(); f.releases[2]!.status = 'failed'; f.releases[2]!.message = '构建失败：缺少依赖';
  page = await renderApp(`/projects/${projectId}/release`);
  // 此前是两张表各自一列 UUID（RFC-020 audit §3.5）。
  expect(rows()).toHaveLength(5); expect(rows()[0]).toStartWith('v1.1.0 就绪bbbbbbb · main'); expect(rows()[3]).toStartWith('v1.0.0 就绪aaaaaaa · main'); expect(rows()[4]).toStartWith('v0.9.0 失败');
  expect(rows()[1]).toContain('成员 01a0bf5d… 把 版本 01a0bf5d… 切为正式版本');
  expect(rows()[2]).toContain('开发者小王 把 v1.0.0 切为正式版本'); expect(rows()[2]).toContain('原因：验收通过');
  expect(rows()[4]).toContain('失败原因：构建失败：缺少依赖'); expect(page.text()).not.toContain(other); expect(page.text()).not.toContain(gone);
  const logs = [...document.querySelectorAll('ul[aria-label="发布记录"] a')].find((link) => link.textContent === '构建日志')!;
  expect(logs.getAttribute('href')).toContain('source=build'); expect(logs.getAttribute('href')).toContain(`releaseId=${historyId}`);
  expect(page.text()).not.toContain('切流记录'); expect(document.querySelector('ul[aria-label="发布记录"]')?.textContent).not.toContain('registry');
  await page.click('v0.9.0'); expect(page.search().release).toBe(historyId); expect(page.text()).toContain('构建失败：缺少依赖');
  await page.click('详情'); expect(page.search().release).toBe(unknownRelease);
});

test('切流或成员读取失败时只列能读到的一类并说明；负责人在待验证卡上直接上线，switch=1 进入即核对', async () => {
  withTimeline({ switchesFail: true, membersFail: true });
  page = await renderApp(`/projects/${projectId}/release?switch=1`); await page.settle(); await page.settle();
  expect(page.text()).toContain('切流记录读取失败：切流服务不可用'); expect(page.text()).toContain('成员名单暂不可读'); expect(rows()).toHaveLength(3); expect(page.text()).not.toContain('尚无发布记录');
  // 概览的「上线 vX…」带 switch=1 进来：不用再点一次，确认面板已经打开。
  expect(page.text()).toContain('正式版本 v1.0.0 → v1.1.0'); expect([...document.querySelectorAll('button')].some((node) => node.textContent === '确认上线 v1.1.0')).toBe(true);
  const versions = document.querySelector('section[aria-label="实际部署版本"]')!;
  expect([...versions.querySelectorAll('button')].map((node) => node.textContent)).toContain('上线 v1.1.0'); expect(page.search()).toMatchObject({ switch: true });
  expect(page.text()).not.toContain(targetId.slice(0, 8) + '…');
});
