import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { NativeWorkspace } from '../features/dev-session/components/native/NativeWorkspace';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { INITIAL_STREAM_STATE } from '../features/dev-session/model/taskStreamSocket';
import { initialWorkspaceLayout } from '../features/dev-session/model/layout/workspaceLayout';
import type { WorkspaceLocation } from '../features/dev-session/model/layout/developmentLocation';
import { renderElement } from './renderElement';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(async () => { page?.unmount(); await new Promise((resolve) => setTimeout(resolve, 0)); page = undefined; globalThis.fetch = originalFetch; });

function setup(errorStatus = 412) {
  const starts: Record<string, unknown>[] = [], saves: Record<string, unknown>[] = [];
  globalThis.fetch = (async (raw: RequestInfo | URL, init?: RequestInit) => {
    const url = String(raw), method = init?.method ?? 'GET';
    let body: unknown = {}, status = 200;
    if (url.endsWith('/workspace-layout')) {
      if (method === 'PUT') { const input = JSON.parse(String(init?.body)); saves.push(input); body = { layout: input.layout, revision: input.expectedRevision + 1, updatedAt: '2026-09-13T00:00:00.000Z' }; }
      else body = { revision: 0, layout: null, updatedAt: null };
    } else if (url.endsWith('/agent-terminals')) {
      if (method === 'POST') { starts.push(JSON.parse(String(init?.body))); status = errorStatus; body = { error: errorStatus === 412 ? 'precondition' : 'unavailable', message: errorStatus === 412 ? '演示档位不支持原生 CLI' : '结果暂未收到', details: {} }; }
      else body = { items: [], connection: 'connected', runnerId: null, checkedAt: '2026-09-13T00:00:00.000Z' };
    } else body = { items: [{ name: 'balanced', description: '标准', terminalOnly: false, isDefault: true, available: true }] };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { starts, saves };
}
const element = (location?: WorkspaceLocation) => <NativeWorkspace projectId="project-1" taskId="task-1" userId="user-1" location={location} channel={{ send: async () => ({}), subscribe: () => () => {} }} stream={{ ...INITIAL_STREAM_STATE, status: 'open', runnerConnected: true, generation: 1 }} canDevelop onActivity={() => {}} preview={<div>真实预览位置</div>} editor={<div>代码位置</div>} changes={<div>差异位置</div>} />;

describe('紧凑原生工作台', () => {
  test('重获焦点读到其他页签的代码视图时，当前 CLI 地址仍控制面板且选择走地址', async () => {
    const f = setup(), base = globalThis.fetch, selected: unknown[] = [];
    page = await renderElement(element({ key: 'cli', search: { view: 'cli' }, selectView: () => {}, selectTool: (tool) => { selected.push(tool); } }), messages);
    globalThis.fetch = (async (raw, init) => String(raw).endsWith('/workspace-layout') && (init?.method ?? 'GET') === 'GET'
      ? Response.json({ revision: 3, layout: { ...initialWorkspaceLayout('远端工作区'), view: 'code' }, updatedAt: '2026-09-20T00:00:00Z' }) : base(raw, init)) as typeof fetch;
    await act(async () => { window.dispatchEvent(new Event('focus')); }); await page.settle();
    // 实机两个浏览器页共用个人布局，旧实现会留在代码页且点击同一个 CLI 地址也无法返回；RFC-020 后面板形态以地址为准，收起态是右缘一条页签栏。
    expect(page.host.querySelector('aside[data-mode]')?.getAttribute('data-mode')).toBe('closed');
    expect(page.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('远端工作区 · 0');
    await page.click('代码'); expect(selected.at(-1)).toEqual({ name: 'code', mode: 'side' });
    page.unmount(); page = undefined;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.saves.at(-1)).toMatchObject({ layout: { view: 'cli' } }); expect((f.saves.at(-1) as { layout: { tool?: unknown } }).layout.tool).toBeUndefined();
  });
  test('新页签不启动 CLI，保存空布局；关闭工作区后仍有工作区', async () => {
    const f = setup(); page = await renderElement(element(), messages);
    await act(async () => page!.host.querySelector<HTMLButtonElement>('button[aria-label="＋ 工作区"]')!.click()); await page.settle();
    expect(page.text()).toContain('工作区 2'); expect(f.starts).toHaveLength(0);
    const settings = [...page.host.querySelectorAll('summary')].find((node) => node.getAttribute('aria-label') === '工作区设置')!;
    await act(async () => settings.click());
    await page.click('关闭工作区');
    expect(page.text()).toContain('工作区 1'); expect(page.text()).not.toContain('工作区 2');
    page.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.saves).toHaveLength(1); expect(f.saves[0]).toMatchObject({ expectedRevision: 0 });
  });
  test('双击只提交一次；明确拒绝后可以改算力档位恢复', async () => {
    const f = setup(); page = await renderElement(element(), messages);
    const add = page.button('＋ 创建开发Agent会话');
    await act(async () => { add.click(); add.click(); }); await page.settle();
    expect(f.starts).toHaveLength(1); expect(f.starts[0]?.clientRequestId).toBeString();
    expect(page.text()).toContain('演示档位不支持原生 CLI');
    expect(page.host.querySelector<HTMLSelectElement>('select[aria-label="算力档位"]')?.disabled).toBe(false);
    expect(page.button('＋ 创建开发Agent会话').disabled).toBe(false);
  });
  test('未确认的请求保留原 UUID 和配置，重试不变成第二次启动', async () => {
    const f = setup(503); page = await renderElement(element(), messages);
    await page.click('＋ 创建开发Agent会话');
    expect(page.text()).toContain('核对并重试原请求');
    await page.click('核对并重试原请求');
    expect(f.starts).toHaveLength(2); expect(f.starts[1]).toEqual(f.starts[0]);
  });
});
