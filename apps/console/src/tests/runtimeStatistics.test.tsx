// RFC-034 v2（proposal/rfc/RFC-034-runtime-observability/redesign-v2-20261014.md §6）：两级运行统计页——
// 总览四卡与日柱图、时间范围、任务键集分页与独立详情路由、泳道与按模型拆分、项目费用可见性、平台执行。
import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { openDialog } from './confirmDialogDriver';
import { renderApp } from './renderApp';
import { runtimeStatisticsFixture } from './runtimeStatisticsFixture';

let page: Awaited<ReturnType<typeof renderApp>> | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
type Fixture = ReturnType<typeof runtimeStatisticsFixture>;
const tabs = () => [...document.querySelectorAll('[role="tab"]')].map((node) => node.textContent);
const lastRead = (f: Fixture, suffix: string) => f.reads.filter((url) => url.pathname.endsWith(suffix)).at(-1)!;
const span = (url: URL) => Date.parse(url.searchParams.get('to')!) - Date.parse(url.searchParams.get('from')!);
const taskRows = () => document.querySelectorAll('[data-runtime-task-id]');
async function search(value: string) {
  const input = document.querySelector<HTMLInputElement>('form[role="search"] input')!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  });
  await page!.click('搜索');
}

describe('RFC-034 v2 runtime statistics: overview, time range and cost visibility', () => {
  test('system overview shows tokens, CNY, outcomes, durations, daily usage and top lists for the last 7 days', async () => {
    const f = runtimeStatisticsFixture(); page = await renderApp('/admin/observability');
    expect(page.text()).toContain('系统运行观测与统计');
    expect(tabs()).toEqual(['总览', '任务', 'Agent 与模型', '项目', '平台执行', '资源与容量', '服务与健康']);
    expect([...document.querySelectorAll('[data-runtime-overview] article')].map((node) => node.getAttribute('aria-label'))).toEqual(['Token 消耗', '人民币估值', 'Agent 执行', '执行时长（P50）']);
    // 有用量不完整的执行：合计是已知下界；有未定价的执行：人民币也是下界。
    expect(page.text()).toContain('≥ 93,000'); expect(page.text()).toContain('≥ ¥150.00');
    expect(page.text()).toContain('2 次用量不完整'); expect(page.text()).toContain('1 次未定价');
    expect(page.text()).toContain('42.0 s'); expect(page.text()).toContain('10.2 min');
    expect(document.querySelectorAll('[aria-label="按天消耗"] button')).toHaveLength(8);
    expect(document.querySelector('[aria-label="按天消耗"] button[aria-pressed="true"]')?.getAttribute('aria-label')).toContain('2026-10-14');
    expect(document.querySelector('[data-runtime-source="platform"]')?.textContent).toContain('未定价');
    expect(page.text()).toContain('Token 最多的项目'); expect(page.text()).toContain('管理项目 12');
    const read = lastRead(f, '/overview');
    expect(read.pathname).toBe('/v1/admin/observability/overview');
    expect(span(read)).toBe(7 * 86_400_000);
    expect(read.searchParams.get('tzOffset')).toBe(String(-new Date().getTimezoneOffset()));
  });

  test('the time range is part of the address, re-reads a 30-day window and unpriced models link to pricing', async () => {
    const f = runtimeStatisticsFixture(); page = await renderApp('/admin/observability?tab=agents');
    await page.click('近 30 天');
    expect(page.search()).toMatchObject({ tab: 'agents', period: 'month' });
    expect(span(lastRead(f, '/agents'))).toBe(30 * 86_400_000); expect(span(lastRead(f, '/models'))).toBe(30 * 86_400_000);
    expect(page.text()).toContain('GLM 档位'); expect(page.text()).toContain('opencode 内置价格线');
    await page.click('配置价格');
    expect(page.path()).toBe('/admin/compute'); expect(page.search()).toMatchObject({ tab: 'pricing', q: 'other/unpriced' });
  });

  test('project page hides CNY until cost visibility is opened and has no system-only tabs', async () => {
    const f = runtimeStatisticsFixture(); page = await renderApp(`/projects/${f.projectId}/observability`);
    expect(page.text()).toContain('项目运行观测与统计');
    expect(tabs()).toEqual(['总览', '任务', 'Agent 与模型', '资源与容量', '服务与健康']);
    expect(page.text()).toContain('该项目未开放人民币估值。'); expect(page.text()).not.toContain('¥'); expect(page.text()).not.toContain('次未定价');
    expect(document.querySelector('[data-runtime-source="platform"]')).toBeNull();
    expect(lastRead(f, '/overview').pathname).toBe(`/v1/projects/${f.projectId}/observability/overview`);
    f.state.projectCostVisible = true; await page.reread();
    expect(page.text()).toContain('≥ ¥150.00'); expect(page.text()).not.toContain('该项目未开放人民币估值。');
  });
});

describe('RFC-034 v2 runtime statistics: tasks, lanes and system views', () => {
  test('tasks page with the keyset cursor and filter by source and keyword without keeping a stale cursor', async () => {
    const f = runtimeStatisticsFixture(); page = await renderApp('/admin/observability?tab=tasks');
    expect(taskRows()).toHaveLength(25);
    await page.click('下一页');
    expect(taskRows()).toHaveLength(5); expect(lastRead(f, '/tasks').searchParams.get('cursor')).toBe('page-2');
    await page.click('开发会话');
    expect(page.search()).toMatchObject({ tab: 'tasks', source: 'development' });
    expect(lastRead(f, '/tasks').searchParams.get('cursor')).toBeNull(); expect(taskRows()).toHaveLength(10);
    await search('Task 2');
    expect(page.search()).toMatchObject({ q: 'Task 2', source: 'development' });
    expect(lastRead(f, '/tasks').searchParams.get('q')).toBe('Task 2');
    expect([...taskRows()].map((row) => row.getAttribute('data-runtime-task-id'))).toEqual(['task-2', 'task-20', 'task-23', 'task-26', 'task-29']);
  });

  test('the last task row opens its own route with lanes and calls, and the way back keeps the filters', async () => {
    runtimeStatisticsFixture(); page = await renderApp('/admin/observability?tab=tasks&q=Task');
    await page.click('Task 24');
    expect(page.path()).toBe('/admin/observability/tasks/task-24');
    expect(document.querySelector('[data-runtime-task="task-24"]')).not.toBeNull(); expect(document.querySelector('[data-runtime-statistics]')).toBeNull();
    expect(page.text()).toContain('≥ 3,600');
    expect([...document.querySelectorAll('[data-runtime-lanes] button[aria-label]')].map((node) => node.getAttribute('aria-label'))).toEqual([
      'Coder · 第 1 次尝试 · 失败 · 5.0 min', 'Coder · 第 2 次尝试 · 完成 · 14.0 min', 'Reviewer · 第 1 次尝试 · 进行中 · 39.0 min',
    ]);
    expect(document.querySelectorAll('[data-runtime-call-id]')).toHaveLength(3);
    expect(document.querySelector('[data-runtime-call-id="call-1"]')?.textContent).toContain('≥ 1,000');
    await page.click('返回统计');
    expect(page.path()).toBe('/admin/observability'); expect(page.search()).toMatchObject({ tab: 'tasks', q: 'Task' });
  });

  test('a lane opens the run with its per-model split; unknown price and partial usage are never shown as zero', async () => {
    runtimeStatisticsFixture(); page = await renderApp('/admin/observability/tasks/task-0');
    const bar = document.querySelector<HTMLButtonElement>('[aria-label="Reviewer · 第 1 次尝试 · 进行中 · 39.0 min"]')!;
    bar.focus(); await act(async () => bar.click()); await page.settle();
    const dialog = openDialog();
    expect(dialog.querySelector('h2')?.textContent).toBe('Reviewer · 第 1 次尝试');
    expect(dialog.textContent).toContain('部分（已知下界）'); expect(dialog.textContent).toContain('≥ 500'); expect(dialog.textContent).toContain('≥ ¥1.00');
    const models = [...dialog.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent));
    expect(models).toEqual([['zhipu/glm-5', '300', '0', '0', '80', '0', '¥1.00'], ['other/unpriced', '100', '0', '0', '20', '0', '未定价']]);
    await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle();
    expect(document.activeElement).toBe(bar);
    await page.click('放大');
    expect(document.querySelector<HTMLElement>('[data-runtime-lanes]')?.style.minWidth).toBe('1200px');
  });

  test('platform runs and the project ranking are system views; a project opens with the same time range', async () => {
    const f = runtimeStatisticsFixture(); page = await renderApp('/admin/observability?tab=platform');
    expect(page.text()).toContain('档位测试'); expect(page.text()).toContain('GLM 档位 · r3'); expect(page.text()).toContain('opencode 内置价格线');
    expect(document.querySelector('[data-runtime-call-id="call-p"]')?.textContent).toContain('未定价');
    await page.navigate('/admin/observability?tab=projects&period=day');
    expect(span(lastRead(f, '/projects'))).toBe(86_400_000);
    const link = [...document.querySelectorAll('[role="tabpanel"] a')].find((node) => node.textContent === '管理项目 12') as HTMLAnchorElement;
    await act(async () => link.click()); await page.settle();
    expect(page.path()).toBe(`/projects/${f.projectId}/observability`); expect(page.search()).toMatchObject({ period: 'day' });
  });
});
