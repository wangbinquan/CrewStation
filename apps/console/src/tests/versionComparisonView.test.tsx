import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { ComparisonTarget, VersionComparisonDto } from '@crewstation/contracts';
import { focusManager } from '@tanstack/react-query';
import { VersionComparisonDtoSchema } from '@crewstation/contracts';
import { VersionComparisonPanel } from '../features/dev-session/components/workspace/VersionComparisonPanel';
import type { TaskStreamChannel } from '../features/dev-session/hooks/useTaskStream';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { renderElement } from './renderElement';

const originalFetch = globalThis.fetch;
const requests: string[] = [];
const historyTargets: unknown[] = [];
let ui: Awaited<ReturnType<typeof renderElement>> | undefined;
const channel: TaskStreamChannel = { send: async () => ({}), subscribe: () => () => {} };
afterEach(() => { ui?.unmount(); ui = undefined; requests.length = 0; historyTargets.length = 0; globalThis.fetch = originalFetch; focusManager.setFocused(undefined); });

function comparison(): VersionComparisonDto {
  return VersionComparisonDtoSchema.parse({
    comparisonId: 'comparison-1', taskId: `tsk_${'0'.repeat(32)}`, checkedAt: '2026-09-13T00:00:00.000Z', freshness: 'current',
    workspace: { status: 'ready', branch: 'main', headSha: 'a'.repeat(40), shallow: false, fingerprint: 'fp', uncommitted: [{ path: 'file.txt', status: '.M', index: '.', worktree: 'M' }], uncommittedCount: 1, uncommittedTruncated: false, unpushed: { status: 'ready', count: 0, commits: [], truncated: false }, upstream: { status: 'missing' }, checkedAt: '2026-09-13T00:00:00.000Z' },
    deployment: { status: 'ready', target: 'prod', releaseId: `rel_${'0'.repeat(32)}`, tag: 'v0.1.0', commitSha: 'a'.repeat(40), host: 'demo.cs.localhost', state: 'ready' },
    commits: { status: 'equal', ahead: 0, behind: 0 }, files: { status: 'ready', count: 1, untrackedCount: 0 },
  });
}

async function render(data: VersionComparisonDto, canDevelop = true, target: ComparisonTarget = 'prod', onOpenFile?: (path: string) => void, compact = false) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    requests.push(`${init?.method ?? 'GET'} ${path}`);
    if (init?.method === 'POST') historyTargets.push(JSON.parse(String(init.body)).target);
    const url = new URL(path, 'http://localhost');
    const body = path.includes('version-comparisons/') ? {
      comparisonId: 'comparison-1', tab: url.searchParams.get('tab'), commits: [], truncated: false,
      files: [{ path: 'file.txt', status: 'M', additions: 1, deletions: 1, binary: false, untracked: false }], checkedAt: data.checkedAt,
      ...(url.searchParams.has('path') ? { patch: { path: 'file.txt', text: '-old\n+new', binary: false, truncated: true } } : {}),
    } : data;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  ui = await renderElement(<VersionComparisonPanel projectId="prj_test" taskId={data.taskId} channel={channel} canDevelop={canDevelop} target={target} onOpenFile={onOpenFile} compact={compact} />, messages);
  return ui;
}

test('提交一致仍显示未提交文件；四种详情、patch 与截断通过真实查询动作衔接', async () => {
  const page = await render(comparison());
  expect(page.text()).toContain('提交一致');
  expect(page.text()).toContain('未提交文件 1');
  expect(page.text()).toContain('v0.1.0');
  await page.click('查看差异');
  await page.click('相对生产的文件差异');
  await page.click('file.txt');
  expect(page.text()).toContain('+new');
  expect(page.text()).toContain('Patch 超过 64 KiB');
  expect(requests.some((request) => request.includes('path=file.txt'))).toBe(true);
  expect(requests.every((request) => request.startsWith('GET'))).toBe(true);
  await page.click('补齐历史并重算');
  expect(requests.filter((request) => request.startsWith('POST'))).toEqual(['POST /v1/projects/prj_test/dev-session/version-comparison/refresh-history']);
});

test('待验证版本显示对应差距和详情名称，文件定位与补历史作用于实际目标', async () => {
  const data = comparison(); data.deployment = { ...data.deployment, target: 'preview' }; data.commits = { status: 'ahead', ahead: 2, behind: 0 };
  const opened: string[] = [], page = await render(data, true, 'preview', (file) => opened.push(file));
  expect(page.text()).toContain('工作树与待验证版本'); expect(page.text()).not.toContain('待上线 2');
  expect(page.text()).toContain('工作树独有 2 个提交'); await page.click('查看差异'); await page.click('相对待验证的文件差异'); await page.click('在代码中打开');
  expect(opened).toEqual(['file.txt']); expect(requests.some((request) => request.includes('target=preview'))).toBe(true);
  await page.click('补齐历史并重算'); expect(historyTargets).toEqual(['preview']);
});

test('查询回执目标不匹配时显示错误，不把生产差距装进待验证视图', async () => {
  const page = await render(comparison(), true, 'preview');
  expect(page.text()).toContain('比较回执与当前会话或所选部署不一致'); expect(page.text()).not.toContain('v0.1.0'); expect(page.text()).not.toContain('提交一致');
});

test('重新聚焦重读比较，不发补历史写请求', async () => {
  focusManager.setFocused(false); const page = await render(comparison()); const before = requests.length;
  await act(async () => focusManager.setFocused(true)); await page.settle();
  expect(requests.length).toBe(before + 1); expect(requests.every((request) => request.startsWith('GET'))).toBe(true);
});

test('状态未知不显示零差距，只有开发者能补齐历史', async () => {
  const data = comparison();
  data.commits = { status: 'unavailable', reason: '浅历史不完整' };
  const page = await render(data, false);
  expect(page.text()).toContain('暂不可比较');
  expect(page.text()).toContain('浅历史不完整');
  expect(page.text()).not.toContain('待上线 0');
  await page.click('查看差异');
  expect(page.button('补齐历史并重算').disabled).toBe(true);
});

test.each([false, true])('工作树故障传到提交和文件比较时只解释一次，紧凑模式=%s', async (compact) => {
  const data = comparison(), reason = 'Git 结果超过读取上限，无法给出完整检查结果';
  data.workspace = { status: 'unavailable', reason, checkedAt: data.checkedAt };
  data.commits = { status: 'unavailable', reason }; data.files = { status: 'unavailable', reason };
  const page = await render(data, true, 'prod', undefined, compact);
  // 实机 Git 输出超限时，同一上游原因曾在顶部条和详情摘要内各重复三次。
  expect(page.text().split(reason).length - 1).toBe(1);
  expect(page.text()).toContain('暂不可比较'); expect(page.text()).toContain('v0.1.0');
  expect(page.text()).not.toContain('未提交文件 0'); expect(page.text()).not.toContain('待上线 0');
});

test('比较摘要仍保留不同失败原因，去重不隐藏独立问题', async () => {
  const data = comparison();
  data.workspace = { status: 'unavailable', reason: '工作树读取失败', checkedAt: data.checkedAt };
  data.commits = { status: 'unavailable', reason: '历史对象缺失' };
  data.files = { status: 'unavailable', reason: '文件差异读取失败' };
  const page = await render(data);
  for (const reason of ['工作树读取失败', '历史对象缺失', '文件差异读取失败']) expect(page.text().split(reason).length - 1).toBe(1);
  expect(page.text()).toContain('暂不可比较');
});

test('共享页签支持方向键，选中标签与面板名称关联', async () => {
  const page = await render(comparison());
  await page.click('查看差异');
  const first = page.host.querySelector<HTMLButtonElement>('[role="tab"]')!;
  await act(async () => { first.focus(); first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
  await page.settle();
  const selected = page.host.querySelector('[role="tab"][aria-selected="true"]')!;
  expect(selected.textContent).toBe('缺少的生产提交');
  expect(page.host.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(selected.id);
});

test('尚未部署默认展示未提交改动；不可比较页签解释原因，不发送必然失败的详情请求', async () => {
  const data = comparison();
  data.deployment = { status: 'undeployed', target: 'prod' };
  data.commits = { status: 'undeployed' };
  data.files = { status: 'unavailable', reason: '尚无生产版本可比较文件' };
  const page = await render(data);
  await page.click('查看差异');
  expect(page.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('未提交改动');
  await page.click('待上线提交');
  expect(page.host.querySelector('[role="tabpanel"]')?.textContent).toContain('尚无生产版本');
  await page.click('相对生产的文件差异');
  expect(page.text()).toContain('尚无生产版本可比较文件');
  expect(requests.filter((request) => request.includes('version-comparisons/')).every((request) => request.includes('tab=uncommitted'))).toBe(true);
  expect(page.text()).not.toContain('旧结果可能已过期');
});
