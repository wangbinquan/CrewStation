import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import type { DevSessionDto, StartupStage } from '@crewstation/contracts';
import { activityProjectId } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined, fixture: ReturnType<typeof editorWorkspaceFixture> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); fixture?.restore(); fixture = undefined; });
const path = `/projects/${activityProjectId}/dev-session`;
const at = (second: number) => new Date(Date.parse('2026-09-23T03:00:00.000Z') + second * 1000).toISOString();
const done = (kind: StartupStage['kind'], from: number, to: number): StartupStage => ({ kind, state: 'succeeded', startedAt: at(from), endedAt: at(to), durationMs: Math.round((to - from) * 1000) });

/** 开发会话的启动进度（RFC-022 D7），重试的请求记下来。 */
function setup(state: 'creating' | 'failed', startup: NonNullable<DevSessionDto['startup']>) {
  const f = editorWorkspaceFixture(); fixture = f;
  f.sessionState.state = state; f.sessionState.startup = startup;
  const fetch = globalThis.fetch, starts: string[] = [];
  globalThis.fetch = (async (raw, init) => {
    const url = String(raw);
    if (url.endsWith('/branches')) return Response.json({ items: [{ name: 'main', headSha: 'a'.repeat(40), isDefault: true, behindPreview: 0, behindProd: 0 }] });
    if (url.endsWith('/dev-session') && init?.method === 'POST') { starts.push(String(init.body)); return Response.json({ error: 'unavailable', message: '稍后再试', details: {} }, { status: 503 }); }
    return fetch(raw, init);
  }) as typeof fetch;
  return { f, starts };
}
const chip = () => [...document.querySelectorAll('header')].find((node) => node.querySelector('h1')?.textContent === '开发会话')!.querySelector('button')!;

test('开始开发中：CLI 区域中间是五段步骤条，检出代码带分支名；页头芯片显示当前段；不再叠一条连接说明', async () => {
  setup('creating', { state: 'running', startedAt: at(0), observedAt: at(6), stages: [done('queue', 0, 0.1), done('container', 0.1, 3), { kind: 'checkout', state: 'running', startedAt: at(3), subject: 'main', detail: '正在克隆分支 main' }, { kind: 'connect', state: 'pending' }, { kind: 'ready', state: 'pending' }] });
  page = await renderApp(path);
  const stepper = document.querySelector('section[data-state="running"]')!;
  expect(stepper.getAttribute('aria-label')).toBe('正在准备开发环境 · 分支 main');
  expect([...stepper.querySelectorAll('li')].map((li) => li.getAttribute('data-state'))).toEqual(['succeeded', 'succeeded', 'running', 'pending', 'pending']);
  expect(stepper.textContent).toContain('检出代码（分支 main）');
  expect(stepper.closest('[role="region"]')?.getAttribute('aria-label')).toBe('CLI 区');
  expect(chip().textContent).toBe('启动中 3/5 · 检出代码（分支 main）');
  expect(page.text()).not.toContain('平台正在准备工作树并连接环境');
  expect([...stepper.querySelectorAll('button')].map((button) => button.textContent)).toEqual([]);
});

test('检出代码失败：停在检出代码并写出原因，「重试」按原分支重新开始开发', async () => {
  const { starts } = setup('failed', { state: 'failed', startedAt: at(0), endedAt: at(9), observedAt: at(10), stages: [done('queue', 0, 0.1), done('container', 0.1, 3),
    { kind: 'checkout', state: 'failed', startedAt: at(3), endedAt: at(9), durationMs: 6000, subject: 'gone', error: { code: 'checkout-failed', message: '容器运行失败：checkout：Error，退出码 128' }, logTail: "fatal: Remote branch gone not found" },
    { kind: 'connect', state: 'pending' }, { kind: 'ready', state: 'pending' }] });
  page = await renderApp(path);
  const stepper = document.querySelector('section[data-state="failed"]')!;
  expect(stepper.getAttribute('aria-label')).toBe('开发环境启动失败 · 分支 main');
  expect(stepper.textContent).toContain('容器运行失败：checkout：Error，退出码 128');
  await page.click('查看容器日志');
  expect(stepper.querySelector('pre')!.textContent).toBe('fatal: Remote branch gone not found');
  await page.click('重试');
  expect(starts).toEqual([JSON.stringify({ branch: 'main' })]);
});

test('等待连接失败（握手被拒）：「重试」打开会话面板里现有的恢复，不另开会话', async () => {
  const { starts } = setup('creating', { state: 'failed', startedAt: at(0), endedAt: at(9), observedAt: at(10), stages: [done('queue', 0, 0.1), done('container', 0.1, 3), done('checkout', 3, 5),
    { kind: 'connect', state: 'failed', startedAt: at(5), endedAt: at(9), durationMs: 4000, error: { code: 'runner-protocol-mismatch', message: 'Runner 协议 2 与平台 3 不一致' } }, { kind: 'ready', state: 'pending' }] });
  page = await renderApp(path);
  expect(document.querySelector('section[data-state="failed"]')!.textContent).toContain('Runner 协议 2 与平台 3 不一致');
  await page.click('重试');
  expect(starts).toEqual([]);
  expect(document.querySelector('aside[data-mode="side"] [role="tab"][aria-selected="true"]')?.textContent).toBe('会话与环境');
});
