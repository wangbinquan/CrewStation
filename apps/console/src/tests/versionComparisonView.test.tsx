import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { VersionComparisonDto } from '@crewstation/contracts';
import { VersionComparisonDtoSchema } from '@crewstation/contracts';
import { VersionComparisonPanel } from '../features/dev-session/components/workspace/VersionComparisonPanel';
import type { TaskStreamChannel } from '../features/dev-session/hooks/useTaskStream';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { renderElement } from './renderElement';

const originalFetch = globalThis.fetch;
const requests: string[] = [];
let ui: Awaited<ReturnType<typeof renderElement>> | undefined;
const channel: TaskStreamChannel = { send: async () => ({}), subscribe: () => () => {} };
afterEach(() => { ui?.unmount(); ui = undefined; requests.length = 0; globalThis.fetch = originalFetch; });

function comparison(): VersionComparisonDto {
  return VersionComparisonDtoSchema.parse({
    comparisonId: 'comparison-1', taskId: `tsk_${'0'.repeat(32)}`, checkedAt: '2026-09-13T00:00:00.000Z', freshness: 'current',
    workspace: { status: 'ready', branch: 'main', headSha: 'a'.repeat(40), shallow: false, fingerprint: 'fp', uncommitted: [{ path: 'file.txt', status: '.M', index: '.', worktree: 'M' }], uncommittedCount: 1, uncommittedTruncated: false, unpushed: { status: 'ready', count: 0, commits: [], truncated: false }, upstream: { status: 'missing' }, checkedAt: '2026-09-13T00:00:00.000Z' },
    deployment: { status: 'ready', target: 'prod', releaseId: `rel_${'0'.repeat(32)}`, tag: 'v0.1.0', commitSha: 'a'.repeat(40), host: 'demo.cs.localhost', state: 'ready' },
    commits: { status: 'equal', ahead: 0, behind: 0 }, files: { status: 'ready', count: 1, untrackedCount: 0 },
  });
}

async function render(data: VersionComparisonDto, canDevelop = true) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    requests.push(`${init?.method ?? 'GET'} ${path}`);
    const url = new URL(path, 'http://localhost');
    const body = path.includes('version-comparisons/') ? {
      comparisonId: 'comparison-1', tab: url.searchParams.get('tab'), commits: [], truncated: false,
      files: [{ path: 'file.txt', status: 'M', additions: 1, deletions: 1, binary: false, untracked: false }], checkedAt: data.checkedAt,
      ...(url.searchParams.has('path') ? { patch: { path: 'file.txt', text: '-old\n+new', binary: false, truncated: true } } : {}),
    } : data;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  ui = await renderElement(<VersionComparisonPanel projectId="prj_test" taskId={data.taskId} channel={channel} canDevelop={canDevelop} />, messages);
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
