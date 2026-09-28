// RFC-034: real routes, local detail dialogs, filters and exact CNY presentation.
import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { RuntimeNativeCaptureSchema } from '@crewstation/contracts';
import { renderApp } from './renderApp';
import { openDialog } from './confirmDialogDriver';
import { runtimeStatisticsFixture } from './runtimeStatisticsFixture';
import { runtimeCny, runtimeTokens, runtimeDuration } from '../features/observability/model/runtimeFormat';
import { parseRuntimeSearch, runtimeWindow } from '../features/observability/model/runtimeSearch';
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
test('system overview, five tabs and pricing link show real CNY DTOs', async () => {
  const f = runtimeStatisticsFixture(); page = await renderApp('/admin/observability?' + f.query);
  expect(page.text()).toContain('系统运行观测与统计'); expect(page.text()).toContain('2,400'); expect(page.text()).toContain('¥6');
  expect(document.querySelector('[data-runtime-metrics]')?.children.length).toBe(3);
  await page.click('用量与费用'); expect(page.text()).toContain('actual-model-hash'); expect(page.text()).toContain('算力档位分布');
  await page.click('性能与质量'); expect(page.text()).toContain('完成任务 P95'); expect(page.text()).toContain('执行时间证据缺失');
  await page.click('配置 Token 人民币单价'); expect(page.path()).toBe('/admin/compute'); expect(page.search()).toMatchObject({ tab: 'pricing' });
});
test('last task opens an independent route and returning restores filters, scroll and focus', async () => {
  const f = runtimeStatisticsFixture(); page = await renderApp('/admin/observability?tab=tasks&q=Task&' + f.query);
  const main = document.querySelector('main')!; main.scrollTop = 510;
  await page.click('Task 23'); expect(page.path()).toBe('/admin/observability/tasks/' + f.details[23]!.id);
  expect(document.querySelector('[data-runtime-task]')).not.toBeNull(); expect(document.querySelector('[data-runtime-statistics]')).toBeNull(); expect(page.text()).toContain('Agent 执行泳道');
  await page.click('返回统计列表'); await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
  expect(page.search()).toMatchObject({ tab: 'tasks', q: 'Task', from: f.from, to: f.to }); expect(main.scrollTop).toBe(510); expect(document.activeElement?.textContent).toBe('Task 23');
});
test('last Agent details use the shared modal, Esc returns focus and task drill keeps Agent context', async () => {
  const f = runtimeStatisticsFixture(); page = await renderApp('/admin/observability?tab=agents&' + f.query);
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('tbody button')].at(-1)!; trigger.focus(); await act(async () => trigger.click()); await page.settle();
  expect(openDialog().textContent).toContain('Agent 23'); expect(openDialog().textContent).toContain('Task 23');
  await act(async () => openDialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle(); expect(document.activeElement).toBe(trigger);
  await page.click('Agent 23'); await page.click('Task 23'); expect(page.path()).toContain('/tasks/');
  await page.click('返回统计列表'); expect(page.search().tab).toBe('agents'); expect(openDialog().textContent).toContain('Agent 23');
});
test('attempt swimlane opens immediate details and zoom only changes the local timeline', async () => {
  const f = runtimeStatisticsFixture(); page = await renderApp('/admin/observability/tasks/' + f.details[0]!.id + '?' + f.query);
  const bar = document.querySelector<HTMLButtonElement>('[aria-label="Agent 0 · 第 1 次 · 10.0 s"]')!; bar.focus(); await act(async () => bar.click()); await page.settle();
  expect(openDialog().textContent).toContain('执行标识'); expect(openDialog().textContent).toContain('¥0.25');
  // A selected attempt must resolve against the refreshed snapshot, not the object captured on click.
  const attempt = f.details[0]!.attempts[0]!;
  attempt.metrics = { ...attempt.metrics, tokens: { ...attempt.metrics.tokens, input: '280', total: '300' }, cost: { ...attempt.metrics.cost, amount: '1.25' } };
  attempt.durationMs = 15000; attempt.endedAt = '2026-09-28T00:00:15.000Z';
  await page.reread(); expect(openDialog().textContent).toContain('¥1.25'); expect(openDialog().textContent).toContain('300'); expect(openDialog().textContent).toContain('15.0 s');
  await act(async () => openDialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle(); expect(document.activeElement).toBe(bar);
  await page.click('放大 2 倍'); expect(document.querySelector<HTMLElement>('[aria-label="Agent 执行泳道"]')?.firstElementChild?.getAttribute('style')).toContain('1200');
  await page.click('适应宽度'); expect(page.text()).toContain('活跃时间并集');
});
test('project navigation uses its own projection, hidden cost and no model distribution', async () => {
  const f = runtimeStatisticsFixture(); page = await renderApp('/projects/' + f.projectId + '/observability?' + f.query);
  expect(page.text()).toContain('项目运行观测与统计'); expect(page.text()).toContain('项目尚未开放费用查看');
  await page.click('用量与费用'); expect(page.text()).not.toContain('actual-model-hash'); expect(page.text()).not.toContain('实际模型分布');
  expect(f.reads.some((p) => p.startsWith('/v1/projects/' + f.projectId))).toBe(true);
  expect(f.directory.writes()).toEqual([]);
});
test('trend and quality drill-down preserve exact windows; empty and failed reads are distinct', async () => {
  const f = runtimeStatisticsFixture(); page = await renderApp('/admin/observability?' + f.query);
  expect(document.querySelectorAll('[aria-label="任务与 Token 趋势"] button')).toHaveLength(24);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="任务与 Token 趋势"] button')!.click()); await page.settle(); expect(page.search()).toMatchObject({ tab: 'tasks', from: f.from, to: '2026-09-28T01:00:00.000Z' });
  await page.click('性能与质量'); await act(async () => document.querySelector<HTMLButtonElement>('tbody button')!.click()); await page.settle(); expect(page.search().quality).toBe('timing-missing'); expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
  await page.click('清除质量筛选'); expect(document.querySelectorAll('tbody tr')).toHaveLength(24);
  f.state.empty = true; await page.reread(); expect(page.text()).toContain('当前条件下没有任务');
  f.state.error = true; await page.reread(); expect(page.text()).toContain('Ledger temporarily unavailable'); expect(page.text()).not.toContain('当前条件下没有任务');
});
test('exact amounts, unknown/zero and invalid URL windows do not collapse', () => {
  const f = runtimeStatisticsFixture(), m = f.metrics;
  expect(runtimeTokens({ ...m, tokens: { ...m.tokens, total: '90071992547409930001' } })).toBe('90,071,992,547,409,930,001');
  expect(runtimeTokens({ ...m, tokens: { ...m.tokens, total: '0', hasKnown: false } })).toBe('—');
  expect(runtimeCny({ ...m, cost: { ...m.cost, amount: '0' } })).toBe('¥0'); expect(runtimeCny({ ...m, cost: { ...m.cost, amount: '0.000000000001' } })).toBe('< ¥0.000001');
  expect(runtimeCny({ ...m, cost: { ...m.cost, amount: '0.000000000001', complete: false } })).toBe('≥ ¥0.000000000001');
  expect(runtimeCny({ ...m, cost: { ...m.cost, amount: '1.000000999999', complete: false } })).toBe('≥ ¥1');
  expect(runtimeCny({ ...m, cost: { ...m.cost, complete: false } })).toBe('≥ ¥0.25'); expect(runtimeDuration(null)).toBe('—');
  expect(parseRuntimeSearch({ tab: 'invalid', from: f.to, to: f.from })).toEqual({}); expect(runtimeWindow({}, Date.parse(f.to)).from).toBe(f.from);
});


test('CSV download requests the visible filters and keeps export errors separate from the page', async () => {
  const f = runtimeStatisticsFixture(), create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  const clicks: Array<{ name: string; href: string }> = [], originalClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = () => 'blob:runtime-export-test'; URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () { clicks.push({ name: this.download, href: this.href }); };
  try {
    page = await renderApp('/admin/observability?tab=agents&q=Task&state=closed&quality=timing-missing&' + f.query);
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1); expect(page.text()).toContain('Agent 0'); expect(page.text()).not.toContain('Agent 1');
    await page.click('导出当前范围 CSV'); expect(f.exports).toEqual([{ window: { from: f.from, to: f.to, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, view: 'agents', q: 'Task', state: 'closed', quality: 'timing-missing' }]);
    expect(clicks).toEqual([{ name: 'statistics.csv', href: 'blob:runtime-export-test' }]); expect(page.text()).toContain('已导出 1 行');
    f.state.error = true; await page.click('导出当前范围 CSV'); expect(page.text()).toContain('Ledger temporarily unavailable'); expect(clicks).toHaveLength(1);
  } finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; HTMLAnchorElement.prototype.click = originalClick; }
});

test('native capture evidence stays inside the selected attempt dialog, follows refresh and preserves focus', async () => {
  const f = runtimeStatisticsFixture(), task = f.details[0]!, attempt = task.attempts[0]!;
  const capture = RuntimeNativeCaptureSchema.parse({ id: 'native-proof', identity: { projectId: task.projectId, taskId: task.id, subtaskId: attempt.id, executionId: attempt.executionId, executionGeneration: attempt.attempt }, sourceId: 'runner',
    proof: { contract: 'opencode-child-steps-v1', lineageKey: 'session', turn: 'turn', turnIndex: 0, state: 'pending', root: 'root', observedAt: f.from,
      baseline: { kind: 'fresh', fingerprint: null }, fingerprint: null, sessions: 0, steps: 0, emitted: 0, baselineSteps: 0, priorRevisionGap: false, issues: [] },
    state: 'pending', receivedSteps: 0, receivedBaselineSteps: 0, unresolvedBaselineSteps: 0, revisedBaselineSteps: 0, historicalRevisionGap: false, issues: [] });
  attempt.nativeCaptures = [capture];
  page = await renderApp('/admin/observability/tasks/' + task.id + '?' + f.query);
  const bar = document.querySelector<HTMLButtonElement>('[aria-label="Agent 0 · 第 1 次 · 10.0 s"]')!;
  expect(page.text()).not.toContain('原生采集完整性'); bar.focus(); await act(async () => bar.click()); await page.settle();
  expect(openDialog().textContent).toContain('原生采集完整性'); expect(openDialog().textContent).toContain('采集中');
  expect(openDialog().querySelectorAll('select option')).toHaveLength(1);
  attempt.nativeCaptures = [{ ...capture, state: 'partial', historicalRevisionGap: true, issues: ['native-prior-revision-gap', 'collector-new-gap'], revisedBaselineSteps: 1 }];
  await page.reread(); expect(openDialog().textContent).toContain('部分采集'); expect(openDialog().textContent).toContain('历史修订尚未补算');
  expect(openDialog().textContent).toContain('历史步骤已修订，原任务数值待核对'); expect(openDialog().textContent).toContain('采集器报告了其他数据缺口，请查看运行日志。');
  await act(async () => openDialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle();
  expect(document.activeElement).toBe(bar); expect(document.querySelector('dialog')).toBeNull();
});
