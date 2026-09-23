import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import type { DevSessionDto, StartupStage } from '@crewstation/contracts';
import { activityProjectId, activityTaskId } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { renderApp } from './renderApp';
import { consoleStyles, sourceAt } from './sourceScan';

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
const cliArea = () => document.querySelector('[role="region"][aria-label="CLI 区"]');

test('开始开发中：整页中间是五段步骤条，检出代码带分支名；页头、CLI 区与工具面板等就绪后才出现，就绪后一次揭开', async () => {
  const { f } = setup('creating', { state: 'running', startedAt: at(0), observedAt: at(6), stages: [done('queue', 0, 0.1), done('container', 0.1, 3), { kind: 'checkout', state: 'running', startedAt: at(3), subject: 'main', detail: '正在克隆分支 main' }, { kind: 'connect', state: 'pending' }, { kind: 'ready', state: 'pending' }] });
  page = await renderApp(path);
  const stepper = document.querySelector('section[data-state="running"]')!;
  expect(stepper.getAttribute('aria-label')).toBe('正在准备开发环境 · 分支 main');
  expect([...stepper.querySelectorAll('li')].map((li) => li.getAttribute('data-state'))).toEqual(['succeeded', 'succeeded', 'running', 'pending', 'pending']);
  expect(stepper.textContent).toContain('检出代码（分支 main）');
  // 2026-09-23 作者裁定：连接就绪前整页只有加载层，步骤条从 CLI 区中间移到整页中间，还不能操作的工作区不先画出来。
  expect(stepper.closest('[data-page-loading]')).not.toBeNull();
  expect(cliArea()).toBeNull(); expect(document.querySelector('[aria-label="工具面板"]')).toBeNull();
  expect([...document.querySelectorAll('button')].some((button) => button.textContent === '创建开发Agent会话')).toBe(false);
  expect(page.text()).not.toContain('准备发布'); expect(page.text()).not.toContain('平台正在准备工作树并连接环境');
  expect([...stepper.querySelectorAll('button')].map((button) => button.textContent)).toEqual([]);
  // 启动完成、环境已连上：整页加载层撤掉，工作区一次出现。
  f.sessionState.state = 'running'; f.sessionState.startup = { state: 'ready', startedAt: at(0), endedAt: at(8), observedAt: at(8), stages: [done('queue', 0, 0.1), done('container', 0.1, 3), done('checkout', 3, 5), done('connect', 5, 8), done('ready', 8, 8)] };
  await page.reread();
  expect(document.querySelector('[data-page-loading]')).toBeNull(); expect(cliArea()).not.toBeNull(); expect(page.text()).toContain('准备发布');
});

test('检出代码失败：停在检出代码并写出原因，「重试」按原分支重新开始开发，并带上失败的那个会话供平台回收', async () => {
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
  // RFC-022 2026-09-23 修订：带上失败会话的任务号，平台核对它失败在检出或更早后回收容器与工作卷。
  expect(starts).toEqual([JSON.stringify({ branch: 'main', restartOf: activityTaskId })]);
});

test('等待连接失败（握手被拒）：恢复卡就在整页步骤条下面，不另开会话、不再单给「重试」', async () => {
  const { f, starts } = setup('creating', { state: 'failed', startedAt: at(0), endedAt: at(9), observedAt: at(10), stages: [done('queue', 0, 0.1), done('container', 0.1, 3), done('checkout', 3, 5),
    { kind: 'connect', state: 'failed', startedAt: at(5), endedAt: at(9), durationMs: 4000, error: { code: 'runner-protocol-mismatch', message: 'Runner 协议 2 与平台 3 不一致' } }, { kind: 'ready', state: 'pending' }] });
  // 握手被拒时平台把原因记在环境上（task-runtime runnerLifecycle），会话带 connectionIssue。
  f.sessionState.connectionIssue = { code: 'protocol_mismatch', runnerProtocol: 2, requiredProtocol: 3, message: 'Runner 协议 2 与平台 3 不一致', at: at(9) };
  page = await renderApp(path);
  const stepper = document.querySelector('section[data-state="failed"]')!;
  expect(stepper.textContent).toContain('Runner 协议 2 与平台 3 不一致');
  // 「重试」原本打开会话面板里的恢复；工作区还没出现，恢复卡直接放在步骤条下面。停在失败上不算加载中。
  expect([...stepper.querySelectorAll('button')].map((button) => button.textContent)).not.toContain('重试');
  expect(stepper.closest('[data-page-loading]')).toBeNull(); expect(cliArea()).toBeNull();
  const recover = [...document.querySelectorAll('button')].find((button) => button.textContent === '检查并恢复原工作树');
  expect(recover?.compareDocumentPosition(stepper)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
  expect(starts).toEqual([]);
});

test('步骤条在 CLI 区上下左右都居中：外框撑满 CLI 区（.terminals 不是弹性容器，要 height: 100%），步骤条 margin: auto', () => {
  const css = sourceAt(consoleStyles(), 'features/dev-session/components/native/NativeWorkspace.module.css').code;
  const block = (selector: string) => new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  const frame = block('.sessionStartup');
  expect(frame).toMatch(/display:\s*flex\b/);
  expect(frame).toMatch(/height:\s*100%/);
  expect(frame).toMatch(/box-sizing:\s*border-box/);
  expect(block('.startupPane > *, .sessionStartup > *')).toMatch(/margin:\s*auto/);
  expect(block('.startupPane')).toMatch(/inset:\s*0/);
});
