import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { NativeWorkspace } from '../features/dev-session/components/native/NativeWorkspace';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { INITIAL_STREAM_STATE } from '../features/dev-session/model/taskStreamSocket';
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
    } else body = { items: [{ name: 'balanced', description: '标准' }] };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { starts, saves };
}
const element = () => <NativeWorkspace taskId="task-1" userId="user-1" channel={{ send: async () => ({}), subscribe: () => () => {} }} stream={{ ...INITIAL_STREAM_STATE, status: 'open', runnerConnected: true, generation: 1 }} canDevelop onActivity={() => {}} preview={<div>真实预览位置</div>} editor={<div>代码位置</div>} changes={<div>差异位置</div>} />;

describe('紧凑原生工作台', () => {
  test('新页签不启动 CLI，保存空布局；关闭页签后仍有工作区', async () => {
    const f = setup(); page = await renderElement(element(), messages);
    await page.click('＋ 页签');
    expect(page.text()).toContain('工作区 2'); expect(f.starts).toHaveLength(0);
    const settings = [...page.host.querySelectorAll('summary')].find((node) => node.textContent === '页签设置')!;
    await act(async () => settings.click());
    await page.click('关闭页签');
    expect(page.text()).toContain('工作区 1'); expect(page.text()).not.toContain('工作区 2');
    page.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.saves).toHaveLength(1); expect(f.saves[0]).toMatchObject({ expectedRevision: 0 });
  });
  test('双击只提交一次；明确拒绝后可以改算力档位恢复', async () => {
    const f = setup(); page = await renderElement(element(), messages);
    const add = page.button('＋ CLI');
    await act(async () => { add.click(); add.click(); }); await page.settle();
    expect(f.starts).toHaveLength(1); expect(f.starts[0]?.clientRequestId).toBeString();
    expect(page.text()).toContain('演示档位不支持原生 CLI');
    expect(page.host.querySelector<HTMLSelectElement>('select[aria-label="算力档位"]')?.disabled).toBe(false);
    expect(page.button('＋ CLI').disabled).toBe(false);
  });
  test('未确认的请求保留原 UUID 和配置，重试不变成第二次启动', async () => {
    const f = setup(503); page = await renderElement(element(), messages);
    await page.click('＋ CLI');
    expect(page.text()).toContain('核对并重试原请求');
    await page.click('核对并重试原请求');
    expect(f.starts).toHaveLength(2); expect(f.starts[1]).toEqual(f.starts[0]);
  });
});
