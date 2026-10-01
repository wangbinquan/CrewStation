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
  await act(async () => openDialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle(); expect(document.activeElement?.textContent).toBe('Agent 23');
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


test('both scopes show named profile contributions and have no CSV operation', async () => {
  const f = runtimeStatisticsFixture();
  page = await renderApp('/admin/observability?tab=usage&' + f.query);
  expect(page.text()).not.toContain('CSV');
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('tbody button')].find((b) => b.textContent === 'Compute 23 · r7')!;
  trigger.focus(); await act(async () => trigger.click()); await page.settle();
  expect(openDialog().textContent).toContain('Task 23'); expect(openDialog().textContent).toContain(f.details[23]!.projectName!);
  expect(openDialog().textContent).toContain('¥0.25'); expect(openDialog().textContent).not.toContain('¥6');
  await act(async () => openDialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle(); expect(document.activeElement).toBe(trigger);
  await page.click('Compute 23 · r7'); await page.click('Task 23');
  expect(page.text()).toContain(f.details[23]!.projectName!); expect(page.text()).toContain('Compute 23 · r7');
  await page.click('返回统计列表'); expect(page.search().profile).toBe(f.data.profiles[23]!.key); expect(openDialog().textContent).toContain('Task 23');
  await act(async () => openDialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle(); expect(document.activeElement?.textContent).toBe('Compute 23 · r7');
  page.unmount(); page = undefined;
  page = await renderApp('/projects/' + f.projectId + '/observability?tab=usage&' + f.query);
  expect(page.text()).not.toContain('CSV'); await page.click('Compute 23 · r7');
  expect(openDialog().textContent).toContain('Task 23'); expect(openDialog().textContent).not.toContain('¥');
  expect(f.reads.every((url) => !url.includes('/exports'))).toBe(true);
});

test('each trend column prints exact tokens and unknown or zero has no positive bar', async () => {
  const f = runtimeStatisticsFixture();
  for (const [i, total] of ['90071992547409930001', '0', '0', '2500'].entries()) {
    const row = f.data.trend[i]!; row.metrics = { ...row.metrics, tokens: { ...row.metrics.tokens, total, hasKnown: i !== 2, complete: i < 2 } };
  }
  page = await renderApp('/admin/observability?' + f.query);
  const columns = document.querySelectorAll<HTMLButtonElement>('[aria-label="任务与 Token 趋势"] button');
  expect([...columns].slice(0, 4).map((b) => b.firstElementChild?.textContent)).toEqual(['90,071,992,547,409,930,001', '0', '—', '≥ 2,500']);
  expect(columns[1]!.lastElementChild?.children.length).toBe(0); expect(columns[2]!.lastElementChild?.children.length).toBe(0);
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
  attempt.nativeCaptures = [{ ...capture, state: 'complete', correctedBaselineSteps: 1 }];
  await page.reread();
  expect(openDialog().textContent).toContain('已校正历史步骤');
  expect(openDialog().textContent).not.toContain('历史修订尚未补算');
  const corrected = [...openDialog().querySelectorAll('dt')].find((row) => row.textContent === '已校正历史步骤');
  expect(corrected?.nextElementSibling?.textContent).toBe('1');
  await act(async () => openDialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle();
  expect(document.activeElement).toBe(bar); expect(document.querySelector('dialog')).toBeNull();
});

// Acceptance regression: input/cache/output must be readable at both levels and every task/Agent/compute grouping.
test('individual bucket coverage preserves exact input, known zero, partial zero and unknown output', () => {
  const f = runtimeStatisticsFixture(), m = { ...f.metrics, records: 2, tokens: { ...f.metrics.tokens, input: '9007199254740993', output: '3', total: '9007199254740996', complete: false, hasKnownBuckets: { input: true, cacheRead: true, cacheWrite: true, output: true }, unknownBuckets: { input: 0, cacheRead: 0, cacheWrite: 0, output: 1 } } };
  expect(runtimeTokens(m, 'input')).toBe('≥ 9,007,199,254,740,993'); expect(runtimeTokens(m, 'cacheRead')).toBe('≥ 0'); expect(runtimeTokens(m, 'output')).toBe('≥ 3');
  expect(runtimeTokens({ ...m, tokens: { ...m.tokens, output: '0' } }, 'output')).toBe('≥ 0');
  expect(runtimeTokens({ ...m, tokens: { ...m.tokens, output: '0', hasKnownBuckets: { ...m.tokens.hasKnownBuckets, output: false }, unknownBuckets: { ...m.tokens.unknownBuckets, output: 2 } } }, 'output')).toBe('—');
  expect(runtimeTokens({ ...m, tokens: { ...m.tokens, hasKnown: false } }, 'input')).toBe('—');
});
test('system/project summaries, grouping tables and keyboard-selected trend expose all four exact token buckets', async () => {
  const f = runtimeStatisticsFixture(), row = f.data.trend[0]!;
  row.metrics = { ...row.metrics, tokens: { ...row.metrics.tokens, input: '40', cacheRead: '30', cacheWrite: '10', output: '20', total: '100' } };
  for (const root of ['/admin/observability', '/projects/' + f.projectId + '/observability']) {
    page = await renderApp(root + '?' + f.query);
    const summary = document.querySelector('[data-runtime-metrics] [data-token-buckets]')!;
    expect([...summary.querySelectorAll('[data-token-bucket] dd')].map((el) => el.textContent)).toEqual(['1,920', '0', '0', '480']);
    expect(page.text()).toContain('输出包含推理 Token');
    expect(document.querySelector('tbody tr')?.querySelectorAll('[data-token-bucket]')).toHaveLength(4);
    const column = document.querySelector<HTMLButtonElement>('[aria-label="任务与 Token 趋势"] button')!;
    expect([...column.querySelectorAll<HTMLElement>('[data-token-color]')].map((el) => el.style.height)).toEqual(['40%', '30%', '10%', '20%']);
    expect(column.getAttribute('aria-label')).toContain('缓存读取 Token 30');
    await act(async () => column.focus()); await page.settle();
    expect([...document.querySelectorAll('[aria-label="当前趋势区间"] [data-token-bucket] dd')].map((el) => el.textContent)).toEqual(['40', '30', '10', '20']);
    for (const tab of ['任务明细', 'Agent 分析', '用量与费用']) {
      await page.click(tab); expect(document.querySelector('tbody tr')?.querySelectorAll('[data-token-bucket]')).toHaveLength(4);
    }
    page.unmount(); page = undefined;
  }
});

test('older incomplete zero without per-bucket evidence is unobserved, but newer partial zero stays a lower bound', () => {
  const f = runtimeStatisticsFixture(), m = { ...f.metrics, tokens: { ...f.metrics.tokens, complete: false } };
  expect(runtimeTokens(m, 'cacheRead')).toBe('—');
  expect(runtimeTokens({ ...m, tokens: { ...m.tokens, hasKnownBuckets: { input: true, cacheRead: true, cacheWrite: true, output: true } } }, 'cacheRead')).toBe('≥ 0');
});
