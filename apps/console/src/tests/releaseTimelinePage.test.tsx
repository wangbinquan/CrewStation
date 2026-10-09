import './domSetup';
import { act } from 'react';
import { journeyId, releaseJourneyFixture } from './releaseJourneyFixture';
import { afterEach, expect, test } from 'bun:test';
import { renderApp } from './renderApp';
import { historyId, prodId, projectId, releaseDeliveryFixture, serviceId, userId } from './releaseDeliveryFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const other = '01a0bf5d-8f4b-7222-8222-222222222222', gone = '01a0bf5d-8f4b-7111-8111-111111111111', unknownRelease = '01a0bf5d-8f4b-7000-8000-000000000000';

test('旧记录内嵌五步回看只保留一个返回入口，返回仍携带原历史页游标', async () => {
  const f = releaseDeliveryFixture(); page = await renderApp(`/projects/${projectId}/release/versions/${prodId}?cursor=older-page&focus=${prodId}`);
  expect([...document.querySelectorAll('a')].filter(node => node.textContent === '返回发布总览')).toHaveLength(1);
  await page.click('4确认上线'); expect(page.text()).toContain('未记录'); expect(f.writes).toHaveLength(0);
  await page.click('返回发布总览'); expect(page.search().cursor).toBe('older-page'); expect(page.search().focus).toBe(prodId);
});
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
/** 发布、切流、成员三份查询都到齐才有完整时间线；整套并跑时慢半拍，最多再等几拍。 */
async function untilRows(count: number) { for (let i = 0; i < 12 && rows().length < count; i++) await page!.settle(); }

test('发布历史与切流记录均可访问，旧流程独立显示未记录，失败原因和原版本保持准确', async () => {
  const f = withTimeline(); f.releases[2]!.status = 'failed'; f.releases[2]!.message = '构建失败：缺少依赖';
  page = await renderApp(`/projects/${projectId}/release`); await untilRows(2);
  expect(document.querySelectorAll('a[id^="release-history-"]')).toHaveLength(3);
  expect(rows()).toHaveLength(2); expect(rows()[1]).toContain('开发者小王 把 v1.0.0 切为正式版本'); expect(rows()[1]).toContain('原因：验收通过');
  const link = document.getElementById(`release-history-${historyId}`)!;
  await act(async () => link.click()); await page.settle();
  expect(page.path()).toBe(`/projects/${projectId}/release/versions/${historyId}`); expect(page.text()).toContain('构建失败：缺少依赖'); expect(page.text()).toContain('未记录');
  expect(document.querySelectorAll('dialog')).toHaveLength(0); expect(f.writes).toHaveLength(0);
});

test('切流或成员读取失败仍可查看历史发布，不伪造缺失的操作人', async () => {
  const f = withTimeline({ switchesFail: true, membersFail: true }); page = await renderApp(`/projects/${projectId}/release`);
  expect(page.text()).toContain('切流记录读取失败：切流服务不可用'); expect(page.text()).toContain('成员名单暂不可读');
  expect(document.querySelectorAll('a[id^="release-history-"]')).toHaveLength(3); expect(f.writes).toHaveLength(0);
});

test.each(['header', 'footer'])('超过 40 条历史从第三页末行进入当次向导，%s 返回恢复游标、实际滚动和触发焦点', async place => {
  const f = releaseJourneyFixture(); f.detail.status = 'succeeded'; f.detail.continuation.canVerify = false;
  f.state.rows = [...Array.from({ length: 40 }, (_, i) => ({ ...f.summary(), id: `01a11e42-fe19-7c81-9ce5-${(i + 1).toString(16).padStart(12, '0')}` as never })), f.summary()];
  page = await renderApp(`/projects/${projectId}/release`, undefined, undefined, { scrollRestoration: true }); await page.click('更早的记录'); await page.click('更早的记录'); expect(page.search().cursor).toBe('40');
  const main = () => document.querySelector('main')!;
  main().scrollTop = 640; main().dispatchEvent(new Event('scroll'));
  const trigger = document.getElementById(`release-history-${journeyId}`)!; await act(async () => { trigger.focus(); trigger.click(); }); await page.settle();
  expect(page.path()).toBe(`/projects/${projectId}/release/journeys/${journeyId}`); expect(document.querySelectorAll('dialog')).toHaveLength(0);
  await page.click('2构建与部署'); expect(document.querySelector('h2[tabindex]')?.textContent).toBe('构建与部署'); expect(f.writes).toHaveLength(0);
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a')].filter(node => node.textContent === '返回发布总览');
  await act(async () => links[place === 'header' ? 0 : links.length - 1]!.click()); await page.settle();
  // The real router used to reset main after the history effect had already restored it.
  expect(main().scrollTop).toBe(640);
  expect(page.search().cursor).toBe('40'); expect(document.activeElement?.id).toBe(`release-history-${journeyId}`); expect(f.writes).toHaveLength(0);
});

test('旧版本历史返回同样保留主内容区滚动，路由默认复位不能覆盖历史恢复', async () => {
  const f = releaseDeliveryFixture(); page = await renderApp(`/projects/${projectId}/release`, undefined, undefined, { scrollRestoration: true });
  const main = () => document.querySelector('main')!;
  main().scrollTop = 880; main().dispatchEvent(new Event('scroll'));
  await act(async () => document.getElementById(`release-history-${historyId}`)!.click()); await page.settle();
  expect(page.path()).toBe(`/projects/${projectId}/release/versions/${historyId}`);
  await page.click('返回发布总览'); expect(main().scrollTop).toBe(880);
  expect(document.activeElement?.id).toBe(`release-history-${historyId}`); expect(f.writes).toHaveLength(0);
});

test('标签表在发布页最下方直接展开，列出仓库里的全部标签', async () => {
  withTimeline(); page = await renderApp(`/projects/${projectId}/release`); await untilRows(2); await page.settle();
  // 2026-09-23 作者裁定标签表不再折叠（RFC-020 design §6 修订）：不用先点开，也不能再包进 <details>。
  const titles = [...document.querySelectorAll('main section > header > h2')];
  expect(titles.at(-1)?.textContent).toBe('标签');
  const card = titles.at(-1)!.closest('section')!;
  expect(card.closest('details') === null).toBe(true);
  expect([...card.querySelectorAll('tbody tr')].map((row) => row.querySelector('code')?.textContent)).toEqual(['v1.0.0', 'v1.1.0', 'v0.9.0']);
});
