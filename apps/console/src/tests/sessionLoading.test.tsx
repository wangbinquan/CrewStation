import './domSetup';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { act } from 'react';
import type { WorkspaceLayout } from '@crewstation/contracts';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { EntrySteps } from '../features/dev-session/components/session/SessionEntry';
import type { EntryStep } from '../features/dev-session/model/connection/entryProgress';
import { initialWorkspaceLayout } from '../features/dev-session/model/layout/workspaceLayout';
import type { Progress } from '../shared/ui/progress/stageProgressView';
import { activityProjectId, activityTaskId } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { renderApp } from './renderApp';
import { renderElement } from './renderElement';

/**
 * 2026-09-23 作者裁定：开发页连接就绪之前整页只有加载层（步骤清单、启动步骤条或失败状态卡），不先渲染还不能操作的页头、
 * CLI 区与工具面板；就绪之后再断线仍是工作区加顶部提示。
 */
let page: Awaited<ReturnType<typeof renderApp>> | undefined, fixture: ReturnType<typeof editorWorkspaceFixture> | undefined;
let element: Awaited<ReturnType<typeof renderElement>> | undefined, clock: ReturnType<typeof spyOn> | undefined;
const originalObserver = globalThis.ResizeObserver;
afterEach(async () => {
  page?.unmount(); page = undefined; element?.unmount(); element = undefined; clock?.mockRestore(); clock = undefined;
  await new Promise((resolve) => setTimeout(resolve, 0)); fixture?.restore(); fixture = undefined; globalThis.ResizeObserver = originalObserver;
});
const path = `/projects/${activityProjectId}/dev-session`;
const cover = () => document.querySelector<HTMLElement>('[data-page-loading]');
const cliArea = () => document.querySelector('[role="region"][aria-label="CLI 区"]');
const stepStates = () => [...(cover()?.querySelectorAll('li') ?? [])].map((li) => li.getAttribute('data-state'));
const buttons = () => [...document.querySelectorAll('button')].map((node) => node.textContent);

/** 开发环境的 streamReady 等用例放行（放行时可改成「环境未连上」）；页面通道在此之前一直是「连接中」。 */
function holdStreamReady() {
  type FixtureSocket = { receive(frame: object): void };
  const Base = globalThis.WebSocket as unknown as new (url?: string) => FixtureSocket, held: Array<(connected: boolean) => void> = [];
  let holding = true;
  class Held extends Base {
    override receive(frame: object) {
      if (holding && (frame as { type?: string }).type === 'streamReady') { held.push((connected) => super.receive({ ...frame, connected })); return; }
      super.receive(frame);
    }
  }
  globalThis.WebSocket = Held as unknown as typeof WebSocket;
  return (connected = true) => { holding = false; for (const run of held.splice(0)) run(connected); };
}

/** 请求等用例放行：`match` 命中的 GET 先挂起。 */
function holdRequest(match: (path: string) => boolean, respond?: () => Response) {
  const base = globalThis.fetch; let release = () => {}; const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async (raw, init) => {
    if ((init?.method ?? 'GET') === 'GET' && match(new URL(String(raw), 'http://localhost').pathname)) { await gate; if (respond) return respond(); }
    return base(raw, init);
  }) as typeof fetch;
  return () => release();
}

test('进开发页：连接就绪前整页只有四步清单，页头、CLI 区与工具面板都不渲染；通道与环境连上、布局读完才一次揭开', async () => {
  fixture = editorWorkspaceFixture(); const release = holdStreamReady();
  page = await renderApp(path);
  expect(cover()?.textContent).toContain('正在进入开发环境 · 分支 main');
  expect(stepStates()).toEqual(['succeeded', 'running', 'pending', 'pending']);
  expect(cover()?.querySelector('li[data-state="running"]')?.textContent).toContain('连接页面通道');
  // 没有摆出来却点不了的东西：页头按钮、CLI 区、工具面板都还不在页面上；读屏仍有页面标题。
  expect(cliArea()).toBeNull(); expect(document.querySelector('[aria-label="工具面板"]')).toBeNull();
  expect(buttons()).not.toContain('创建开发Agent会话'); expect(page.text()).not.toContain('准备发布');
  expect(document.querySelector('main h1')?.textContent).toBe('开发会话'); expect(cover()?.getAttribute('aria-busy')).toBe('true');
  expect([...cover()!.querySelectorAll('a')].map((node) => node.textContent)).toEqual(['查看开发会话日志']); expect(buttons()).not.toContain('重新连接页面');
  await act(async () => release()); await page.settle();
  expect(cover()).toBeNull(); expect(cliArea()).not.toBeNull(); expect(page.text()).toContain('准备发布'); expect(buttons()).toContain('创建开发Agent会话');
  expect(page.text()).not.toContain('页面连接尚未就绪'); expect(page.text()).not.toContain('完成环境准备后即可创建开发Agent会话');
});

test('读会话时整页就是第一步：没有页头说明，也没有零散的「读取中」提示', async () => {
  fixture = editorWorkspaceFixture(); const release = holdRequest((pathname) => pathname.endsWith('/dev-session'));
  page = await renderApp(path);
  expect(stepStates()).toEqual(['running', 'pending', 'pending', 'pending']);
  expect(cover()?.textContent).toContain('正在进入开发环境'); expect(cover()?.textContent).toContain('读取会话');
  expect(page.text()).not.toContain('从远端分支创建开发环境'); expect(page.text()).not.toContain('正在读取会话');
  await act(async () => release()); await page.settle();
  expect(cover()).toBeNull(); expect(cliArea()).not.toBeNull();
});

test('页面通道失败过：第二步写明重连次数，立即给「重新连接页面」，点了就换一条新连接', async () => {
  fixture = editorWorkspaceFixture(); holdStreamReady();
  page = await renderApp(path);
  const channelStep = () => [...document.querySelectorAll('li')].find((li) => li.textContent?.includes('连接页面通道'));
  expect(buttons()).not.toContain('重新连接页面');
  // 连接本身被拒（id 为 open 的错误帧）：页面通道没打开，原因写在这一步下面。
  await act(async () => { fixture!.receive({ type: 'error', id: 'open', code: 'unavailable', message: '会话服务暂不可用' }); }); await page.settle();
  expect(channelStep()?.textContent).toContain('会话服务暂不可用');
  expect(buttons()).toContain('重新连接页面');
  const before = fixture.streamsOpened(activityTaskId);
  await page.click('重新连接页面');
  expect(fixture.streamsOpened(activityTaskId)).toBe(before + 1); expect(cover()).not.toBeNull();
});

test('开发环境一直不响应：第三步写明原因；等满 1 分钟给「仍然打开工作区」，点了进入就绪前的工作区与顶部提示', async () => {
  fixture = editorWorkspaceFixture(); const release = holdStreamReady();
  page = await renderApp(path);
  const base = Date.now(); await act(async () => release(false)); await page.settle();
  expect(stepStates()).toEqual(['succeeded', 'succeeded', 'running', 'pending']);
  expect(cover()?.textContent).toContain('页面已连接，开发环境尚未响应'); expect(buttons()).not.toContain('仍然打开工作区');
  // 步骤清单每秒走一次表：本机时钟拨到 61 秒后，等它走一格。
  clock = spyOn(Date, 'now').mockReturnValue(base + 61_000);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); }); await page.settle();
  expect(buttons()).toContain('仍然打开工作区');
  await page.click('仍然打开工作区');
  expect(cover()).toBeNull(); expect(cliArea()).not.toBeNull();
  expect(page.text()).toContain('页面已连接，但环境尚未响应'); expect(buttons()).toContain('查看会话与环境');
});

test('揭开之后再断线不盖回：工作区原样，顶部提示说明环境未连接，连回后照常', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(path);
  expect(cover()).toBeNull(); expect(cliArea()).not.toBeNull();
  await act(async () => fixture!.receive({ type: 'runnerDisconnected' })); await page.settle();
  expect(cover()).toBeNull(); expect(cliArea()).not.toBeNull(); expect(page.text()).toContain('页面已连接，但环境尚未响应');
  await act(async () => fixture!.receive({ type: 'runnerReconnected' })); await page.settle();
  expect(page.text()).not.toContain('页面已连接，但环境尚未响应');
});

test('揭开前量的是加载层：窄内容区不恢复布局记住的工具，揭开后终端可见、面板收起、地址不写回', async () => {
  const observers: Array<(entries: Array<{ contentRect: { width: number } }>) => void> = [];
  globalThis.ResizeObserver = class { constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) { observers.push(callback); } observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  fixture = editorWorkspaceFixture();
  const saved: WorkspaceLayout = { ...initialWorkspaceLayout('工作区 1'), tool: { name: 'preview', mode: 'side', ratio: 0.45 } };
  const layout = holdRequest((pathname) => pathname.endsWith('/workspace-layout'), () => Response.json({ revision: 1, layout: saved, updatedAt: '2026-09-23T00:00:00.000Z' }));
  const stream = holdStreamReady();
  page = await renderApp(path);
  expect(cover()).not.toBeNull(); expect(observers.length).toBeGreaterThan(0);
  await act(async () => { for (const notify of observers) notify([{ contentRect: { width: 700 } }]); }); await page.settle();
  await act(async () => layout()); await page.settle();
  await act(async () => stream()); await page.settle();
  expect(cover()).toBeNull(); expect(page.search()).toEqual({});
  expect(document.querySelector<HTMLElement>('aside[aria-label="工具面板"]')?.dataset.mode).toBe('closed'); expect(cliArea()?.closest('[hidden]')).toBeNull();
});

/** 进页步骤清单：第二步在等，已等 `waited` 毫秒。 */
function waiting(kind: EntryStep['kind'], waited: number): Progress<EntryStep> {
  const at = (offset: number) => new Date(Date.now() - offset).toISOString(), order: EntryStep['kind'][] = ['session', 'channel', 'environment', 'workspace'];
  const index = order.indexOf(kind);
  return { state: 'running', startedAt: at(waited + 1000), stages: order.map((name, i): EntryStep => i < index ? { kind: name, state: 'succeeded', startedAt: at(waited + 1000), endedAt: at(waited), durationMs: 1000 } : i === index ? { kind: name, state: 'running', startedAt: at(waited) } : { kind: name, state: 'pending' }) };
}

test('步骤清单的出口：通道失败过立即给「重新连接页面」，否则等满 10 秒；等满 1 分钟才给「仍然打开工作区」，读会话那一步不给', async () => {
  const actions = () => [...element!.host.querySelectorAll('button')].map((node) => node.textContent);
  const render = async (progress: Progress<EntryStep>, channelTrouble = false) => {
    element?.unmount();
    element = await renderElement(<EntrySteps progress={progress} branch="main" channelTrouble={channelTrouble} onReconnect={() => {}} onOpenAnyway={() => {}} />, messages);
  };
  await render(waiting('channel', 3_000)); expect(actions()).toEqual([]);
  await render(waiting('channel', 3_000), true); expect(actions()).toEqual(['重新连接页面']);
  await render(waiting('channel', 11_000)); expect(actions()).toEqual(['重新连接页面']);
  await render(waiting('environment', 59_000)); expect(actions()).toEqual([]);
  await render(waiting('environment', 61_000)); expect(actions()).toEqual(['仍然打开工作区']);
  await render(waiting('workspace', 61_000)); expect(actions()).toEqual(['仍然打开工作区']);
  await render(waiting('session', 61_000)); expect(actions()).toEqual([]);
  expect(element!.text()).toContain('正在进入开发环境 · 分支 main');
});
