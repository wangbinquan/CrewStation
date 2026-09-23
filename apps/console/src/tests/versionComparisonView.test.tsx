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
/** 回到前台：比较照常自动重读（每 10 秒的核验走同一路径）。页面没有「重新检查」按钮（2026-09-23 裁定）。 */
async function refocus(page: { settle: () => Promise<void> }) { await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle(); }
const defaultFiles = [{ path: 'file.txt', status: 'M', additions: 1, deletions: 1, binary: false, untracked: false }];
afterEach(() => { ui?.unmount(); ui = undefined; requests.length = 0; historyTargets.length = 0; globalThis.fetch = originalFetch; focusManager.setFocused(undefined); });
/** RFC-020：四组改动是同一列表上的分组标题（可展开按钮），不再是页签；这里列出当前展开的组。 */
const expanded = () => [...(ui?.host.querySelectorAll('h4 > button[aria-expanded="true"]') ?? [])].map((node) => node.textContent);

function comparison(): VersionComparisonDto {
  return VersionComparisonDtoSchema.parse({
    comparisonId: 'comparison-1', taskId: '01a0bf5d-8f4b-763b-835f-dfbd2678fdb2', checkedAt: '2026-09-13T00:00:00.000Z', freshness: 'current',
    workspace: { status: 'ready', branch: 'main', headSha: 'a'.repeat(40), shallow: false, fingerprint: 'fp', uncommitted: [{ path: 'file.txt', status: '.M', index: '.', worktree: 'M' }], uncommittedCount: 1, uncommittedTruncated: false, unpushed: { status: 'ready', count: 0, commits: [], truncated: false }, upstream: { status: 'missing' }, checkedAt: '2026-09-13T00:00:00.000Z' },
    deployment: { status: 'ready', target: 'prod', releaseId: '01a0bf5d-8f4b-79fd-80a1-add06e63a170', tag: 'v0.1.0', commitSha: 'a'.repeat(40), host: 'demo.cs.localhost', state: 'ready' },
    commits: { status: 'equal', ahead: 0, behind: 0 }, files: { status: 'ready', count: 1, untrackedCount: 0 },
  });
}

async function render(data: VersionComparisonDto, canDevelop = true, target: ComparisonTarget = 'prod', onOpenFile?: (path: string) => void, compact = false, details: { files?: typeof defaultFiles; nextCursor?: string } = {}) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    requests.push(`${init?.method ?? 'GET'} ${path}`);
    if (init?.method === 'POST') historyTargets.push(JSON.parse(String(init.body)).target);
    const url = new URL(path, 'http://localhost');
    const body = path.includes('version-comparisons/') ? {
      comparisonId: data.comparisonId, tab: url.searchParams.get('tab'), commits: [], truncated: false,
      files: details.files ?? defaultFiles, nextCursor: details.nextCursor, checkedAt: data.checkedAt,
      ...(url.searchParams.has('path') ? { patch: { path: 'file.txt', text: `-old\n+new\n${data.comparisonId}`, binary: false, truncated: true } } : {}),
    } : data;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  ui = await renderElement(<VersionComparisonPanel projectId="01a0bf5d-8f4b-708c-89b0-9c4412e78c07" taskId={data.taskId} channel={channel} canDevelop={canDevelop} target={target} onOpenFile={onOpenFile} compact={compact} />, messages);
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
  expect(requests.filter((request) => request.startsWith('POST'))).toEqual(['POST /v1/projects/01a0bf5d-8f4b-708c-89b0-9c4412e78c07/dev-session/version-comparison/refresh-history']);
});

test('未提交列表解释暂存区与工作区，未跟踪和二进制不混入提交差距', async () => {
  const files = [
    { ...defaultFiles[0]!, path: 'both.txt', status: 'MM' },
    { ...defaultFiles[0]!, path: 'deleted.txt', status: 'MD' },
    { ...defaultFiles[0]!, path: 'new.bin', status: 'untracked', untracked: true, binary: true },
  ];
  const page = await render(comparison(), true, 'prod', () => {}, false, { files });
  await page.click('查看差异'); await page.click('未提交改动');
  const rows = [...page.host.querySelectorAll('tbody tr')];
  // 实机 MM 曾裸露在列表中；读者应能直接知道哪些改动已暂存、哪些仍在工作区。
  expect(rows[0]?.children[1]?.textContent).toBe('暂存区：修改 · 工作区：修改');
  expect(rows[0]?.children[1]?.getAttribute('title')).toBe('Git: MM');
  expect(rows[1]?.children[1]?.textContent).toBe('暂存区：修改 · 工作区：删除');
  expect(rows[1]?.textContent).not.toContain('在代码中打开');
  expect(rows[2]?.children[1]?.textContent).toBe('未跟踪');
  expect(rows[2]?.textContent).toContain('二进制文件');
  expect(rows[2]?.textContent).not.toContain('在代码中打开');
  expect(page.text()).toContain('提交一致'); expect(page.text()).not.toContain('待上线 3');
});

test('比较重查后保留正在阅读的文件，加载新快照的 Patch', async () => {
  const data = comparison(), page = await render(data);
  await page.click('查看差异'); await page.click('待上线提交'); await page.click('未提交改动'); await page.click('file.txt');
  data.comparisonId = 'comparison-2'; await refocus(page);
  // 实机十秒重查曾因 comparisonId 作为 React key，强制退回第一组并关闭 Patch。
  expect(expanded()).toEqual(['未提交改动']);
  expect(page.text()).toContain('comparison-2');
  expect(requests.at(-1)).toContain('version-comparisons/comparison-2?tab=uncommitted');
  expect(requests.at(-1)).toContain('path=file.txt');
});

test('新比较保留详情页签，但不能复用上一个快照的分页游标', async () => {
  const data = comparison(), details: { nextCursor?: string } = { nextCursor: 'old-cursor' };
  const page = await render(data, true, 'prod', undefined, false, details);
  await page.click('查看差异'); await page.click('待上线提交'); await page.click('相对生产的文件差异'); await page.click('下一页');
  expect(requests.at(-1)).toContain('cursor=old-cursor');
  data.comparisonId = 'comparison-2'; delete details.nextCursor; await refocus(page);
  expect(expanded()).toEqual(['相对生产的文件差异']);
  expect(requests.at(-1)).toContain('version-comparisons/comparison-2?tab=files');
  expect(requests.at(-1)).not.toContain('cursor=');
});

test('正在看的文件从新比较中移除时，仍能返回文件列表', async () => {
  const data = comparison(), page = await render(data);
  await page.click('查看差异'); await page.click('相对生产的文件差异'); await page.click('file.txt');
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => String(input).includes('comparison-2?') && new URL(String(input), 'http://localhost').searchParams.get('path') === 'file.txt'
    ? new Response(JSON.stringify({ error: 'not_found', message: '文件已不在差异中' }), { status: 404, headers: { 'content-type': 'application/json' } })
    : previousFetch(input, init)) as typeof fetch;
  data.comparisonId = 'comparison-2'; await refocus(page);
  expect(page.text()).toContain('文件已不在差异中'); expect(page.text()).not.toContain('+new');
  await page.click('返回文件列表'); expect(page.text()).toContain('file.txt');
  expect(page.text()).not.toContain('文件已不在差异中');
});

test('待验证版本显示对应差距和详情名称，文件定位与补历史作用于实际目标', async () => {
  const data = comparison(); data.deployment = { ...data.deployment, target: 'preview' }; data.commits = { status: 'ahead', ahead: 2, behind: 0 };
  const opened: string[] = [], page = await render(data, true, 'preview', (file) => opened.push(file));
  expect(document.querySelector('section[aria-label="工作树与待验证版本"]')).not.toBeNull(); expect(page.text()).not.toContain('待上线 2');
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

test('顶部比较条保留未知状态和可展开原因，自动重读且不触发补历史', async () => {
  const data = comparison(), reason = '开发容器正在重连';
  data.workspace = { status: 'unavailable', reason, checkedAt: data.checkedAt };
  data.commits = { status: 'unavailable', reason }; data.files = { status: 'unavailable', reason };
  const page = await render(data, true, 'prod', undefined, true);
  expect(page.text()).toContain('暂不可比较'); expect(page.text()).toContain('v0.1.0');
  const details = page.host.querySelector('details')!;
  expect(details.open).toBe(false); expect(details.textContent).toContain(reason);
  await act(async () => details.querySelector('summary')!.click()); expect(details.open).toBe(true);
  const previous = requests.length;
  expect(page.text()).not.toContain('重新检查'); Object.assign(data, comparison()); await refocus(page);
  expect(requests.length).toBe(previous + 1); expect(requests.every((request) => request.startsWith('GET'))).toBe(true);
  expect(page.text()).toContain('提交一致'); expect(page.text()).not.toContain(reason);
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

test('分组标题是可展开按钮，展开区与标题关联；收起的组不再读取', async () => {
  const page = await render(comparison());
  await page.click('查看差异');
  const toggles = [...page.host.querySelectorAll<HTMLButtonElement>('h4 > button[aria-expanded]')];
  expect(toggles.map((node) => node.textContent)).toEqual(['待上线提交', '缺少的生产提交', '相对生产的文件差异', '未提交改动']);
  expect(expanded()).toEqual(['待上线提交']);
  expect(document.getElementById(toggles[0]!.getAttribute('aria-controls')!)?.getAttribute('role')).toBe('region');
  const before = requests.length;
  await page.click('待上线提交'); expect(expanded()).toEqual([]); expect(page.host.querySelector('[role="region"]')).toBeNull();
  await page.click('缺少的生产提交'); expect(expanded()).toEqual(['缺少的生产提交']); expect(requests.slice(before).some((request) => request.includes('tab=behind'))).toBe(true);
});

test('尚未部署默认展示未提交改动；不可比较页签解释原因，不发送必然失败的详情请求', async () => {
  const data = comparison();
  data.deployment = { status: 'undeployed', target: 'prod' };
  data.commits = { status: 'undeployed' };
  data.files = { status: 'unavailable', reason: '尚无生产版本可比较文件' };
  const page = await render(data);
  await page.click('查看差异');
  expect(expanded()).toEqual(['未提交改动']);
  await page.click('待上线提交');
  expect(page.host.querySelector('[role="region"][aria-label="待上线提交"]')?.textContent).toContain('尚无生产版本');
  await page.click('相对生产的文件差异');
  expect(page.text()).toContain('尚无生产版本可比较文件');
  expect(requests.filter((request) => request.includes('version-comparisons/')).every((request) => request.includes('tab=uncommitted'))).toBe(true);
  expect(page.text()).not.toContain('旧结果可能已过期');
});

test('例行重新核验在途不改结论：不弹「可能已过期」，读取失败才提示', async () => {
  const page = await render(comparison());
  expect(page.text()).toContain('检查时间'); expect(page.text()).not.toContain('旧结果可能已过期');
  // 每 10 秒的前台核验、回到前台重查都走同一条路径：在途期间已显示的比较结论不变。
  const inner = globalThis.fetch;
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).includes('version-comparisons/')) await gate;
    return inner(input, init);
  }) as typeof fetch;
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
  expect(page.text()).not.toContain('旧结果可能已过期'); expect(page.text()).not.toContain('更新中');
  await act(async () => release()); await page.settle();
  expect(page.text()).not.toContain('旧结果可能已过期'); expect(page.text()).not.toContain('更新中');
  // 没有「重新检查」；例行核验在途时「补齐历史并重算」也不变灰（不用 isFetching 禁用入口）。
  expect(page.text()).not.toContain('重新检查');
  let second!: () => void; const again = new Promise<void>((resolve) => { second = resolve; });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).includes('version-comparisons/')) await again;
    return inner(input, init);
  }) as typeof fetch;
  await refocus(page); expect(page.button('补齐历史并重算').disabled).toBe(false);
  await act(async () => second()); await page.settle(); expect(page.button('补齐历史并重算').disabled).toBe(false);
});
