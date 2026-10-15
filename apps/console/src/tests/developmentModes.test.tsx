import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import { renderDeliveryHarness } from './renderDeliveryHarness';
import { historicalConversationFixture } from './historicalConversationFixture';
import { activityProjectId } from './agentActivityFixture';

let page: Awaited<ReturnType<typeof renderDeliveryHarness>> | undefined;
let fixture: ReturnType<typeof historicalConversationFixture> | undefined;
afterEach(() => { page?.unmount(); page = undefined; fixture?.restore(); fixture = undefined; sessionStorage.clear(); });
const path = `/projects/${activityProjectId}/dev-session`;
function textarea() { return [...document.querySelectorAll<HTMLTextAreaElement>('textarea')].find(node => !node.closest('[hidden]'))!; }
async function draft(value: string) {
  await act(async () => {
    const node = textarea(); node.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  }); await page!.settle();
}
async function setup(search = 'view=guided') {
  fixture = historicalConversationFixture(); fixture.agents.splice(0);
  page = await renderDeliveryHarness(`${path}?${search}`); return fixture;
}

test('CLI 和 Bot 是对等模式；切换保留草稿，不启动 Agent、不触发离开确认', async () => {
  const f = await setup(); await draft('做一个贪吃蛇游戏'); const input = textarea();
  await page!.click('CLI'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
  expect(input.closest('[hidden]')).not.toBeNull();
  await page!.click('Bot 聊天'); expect(textarea()).toBe(input); expect(textarea().value).toBe('做一个贪吃蛇游戏');
  expect(f.starts).toHaveLength(0); expect(f.sends).toHaveLength(0);
  await page!.go(`/projects/${activityProjectId}`); expect(document.querySelector('dialog[open]')?.textContent).toContain('继续编辑');
  await page!.click('继续编辑'); expect(textarea().value).toBe('做一个贪吃蛇游戏');
});

test('发送中的 Bot 请求跨模式完成；返回后显示本次消息和输出且不重复派发', async () => {
  const f = await setup(); await draft('做一个贪吃蛇游戏'); await page!.click('发送'); expect(f.starts).toHaveLength(1);
  await page!.click('CLI'); await act(async () => { f.finishStart(0); }); await page!.settle();
  await act(async () => { f.receiveAgent({ agentId: 'legacy-created-0', type: 'user-message', text: '做一个贪吃蛇游戏' }); f.receiveAgent({ agentId: 'legacy-created-0', type: 'text', text: '游戏已加入方向键控制。' }); await new Promise(resolve => setTimeout(resolve, 100)); });
  await page!.click('Bot 聊天'); expect(textarea().value).toBe('');
  const log = document.querySelector('[role="log"]'); expect(log?.textContent).toContain('做一个贪吃蛇游戏'); expect(log?.textContent).toContain('游戏已加入方向键控制。');
  expect(f.starts).toHaveLength(1); expect(f.sends).toHaveLength(0);
});

test('CLI 编辑器跨 Bot 切换保持实例、未保存内容与文件定位；隐藏模式不改写当前地址', async () => {
  await setup('view=code&file=a.ts');
  const content = document.querySelector<HTMLElement>('.cm-content')!; const editor = EditorView.findFromDOM(content)!;
  await act(async () => { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'const snake = 1;' } }); });
  await page!.click('Bot 聊天'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0); expect(page!.search()).toMatchObject({ view: 'guided' });
  await draft('帮我完善碰撞检测'); await page!.settle(); expect(page!.search()).toMatchObject({ view: 'guided' });
  await page!.click('CLI'); expect(document.querySelector('.cm-content')).toBe(content); expect(editor.state.doc.toString()).toBe('const snake = 1;');
  expect(page!.search()).toMatchObject({ view: 'code', file: 'a.ts' });
  await page!.click('Bot 聊天'); expect(textarea().value).toBe('帮我完善碰撞检测');
});

test('刷新准备中的 Bot 仍显示已受理需求；原生输入事件回放后不重复消息', async () => {
  fixture = historicalConversationFixture(); const agent = fixture.agents[0]!;
  agent.initialPrompt = '保留尚在准备中的需求'; agent.state = 'preparing';
  page = await renderDeliveryHarness(`${path}?view=guided`);
  expect(document.querySelector('[role="log"]')?.textContent).toContain(agent.initialPrompt);
  page.unmount(); page = await renderDeliveryHarness(`${path}?view=guided`);
  expect(document.querySelectorAll('article[aria-label="你"]')).toHaveLength(1);
  await act(async () => { fixture!.receiveAgent({ agentId: agent.agentId, type: 'user-message', text: agent.initialPrompt }); await new Promise(resolve => setTimeout(resolve, 100)); });
  expect(document.querySelectorAll('article[aria-label="你"]')).toHaveLength(1); expect(fixture.starts).toHaveLength(0);
});
