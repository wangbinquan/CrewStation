import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { activityProjectId } from './agentActivityFixture';
import { historicalConversationFixture, historyAgentA } from './historicalConversationFixture';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined, fixture: ReturnType<typeof historicalConversationFixture> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; fixture?.restore(); fixture = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); });
const cliPath = `/projects/${activityProjectId}/dev-session`, path = `${cliPath}/conversations`;
const prompt = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="首条指令"]')!;
const message = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="发给 Agent 的消息"]')!;
const compute = () => document.querySelector<HTMLSelectElement>('#agent-compute')!;
const button = (label: string) => [...document.querySelectorAll('button')].find((node) => node.textContent === label)!;
async function edit(node: HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const readyBy = Date.now() + 1000;
  while (node.disabled && Date.now() < readyBy) await page!.settle();
  expect(node.disabled).toBe(false);
  // happy-dom 下 React 走 input 事件的兼容路径，只认它收到过 focusin 的控件；弹窗（经 DialogHost 的 portal）关闭时焦点在提交阶段
  // 还给这个输入框，React 收不到那次 focusin。已经聚焦时先移开再聚焦，保证有一次 focusin（浏览器走原生 input 事件，不受影响）。
  if (document.activeElement === node) await act(async () => { node.blur(); });
  await act(async () => { node.focus(); const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}
async function open() { fixture = historicalConversationFixture(); page = await renderApp(path); await page.click('新建 Agent'); }
async function finish(index: number, failed = false) { await act(async () => fixture!.finishStart(index, failed)); await page!.settle(); }
/** 2026-09-23 起新建 Agent 是弹窗：「取消」只关窗回到名册与对话，草稿留着；启动进行中也能关。 */
async function backToRoster() {
  const cancel = [...document.querySelector('dialog[open]')!.querySelectorAll('button')].find((node) => node.textContent === '取消')!;
  await act(async () => cancel.click()); await page!.settle(); expect(document.querySelectorAll('dialog[open]').length).toBe(0);
}

test('新建历史 Agent 收起再打开保留首条指令和档位，隐藏草稿也保护返回 CLI', async () => {
  await open(); await edit(prompt(), '尚未启动的首条指令'); await edit(compute(), '01a0bf5d-8f4b-7222-8222-222222222222');
  await backToRoster(); await page!.click('新建 Agent');
  // 旧表单被条件卸载，点返回即销毁首条指令及已选档位。
  expect(prompt().value).toBe('尚未启动的首条指令'); expect(compute().value).toBe('01a0bf5d-8f4b-7222-8222-222222222222');
  await backToRoster(); await page!.click('返回 CLI 工作区');
  expect(page!.path()).toBe(path); expect(page!.text()).toContain('历史对话输入有未保存的输入');
  await page!.click('继续编辑'); await page!.click('新建 Agent'); expect(prompt().value).toBe('尚未启动的首条指令');
  await backToRoster(); await page!.click('返回 CLI 工作区'); await page!.click('放弃输入并离开'); expect(page!.path()).toBe(cliPath);
  expect(fixture!.starts).toHaveLength(0); expect(fixture!.sends).toHaveLength(0);
});

test('历史 Agent 启动同步防重，失败保留固定输入且不自动重发，在途不能确认离开', async () => {
  await open(); await edit(prompt(), '  只启动一次  '); await edit(compute(), '01a0bf5d-8f4b-7222-8222-222222222222');
  // React 更新 disabled 之前的两次点击也只能产生一个真正的启动请求。
  await act(async () => { button('启动').click(); button('启动').click(); }); await page!.settle();
  expect(fixture!.starts).toHaveLength(1); expect(fixture!.starts[0]!.input).toEqual({ compute: { kind: 'profile', profileId: '01a0bf5d-8f4b-7222-8222-222222222222' }, prompt: '只启动一次' });
  expect(prompt().disabled).toBe(true); expect(compute().disabled).toBe(true);
  await backToRoster(); await page!.click('返回 CLI 工作区'); expect(page!.path()).toBe(path); expect(button('放弃输入并离开').disabled).toBe(true);
  await finish(0, true); expect(button('放弃输入并离开').disabled).toBe(false); await page!.click('继续编辑');
  // 关窗期间启动失败：原因先写在面板上，再打开新建弹窗时输入原样、原因在弹窗里。
  expect(page!.text()).toContain('上游未确认启动结果'); await page!.click('新建 Agent');
  expect(prompt().value).toBe('  只启动一次  '); expect(compute().value).toBe('01a0bf5d-8f4b-7222-8222-222222222222');
  expect(page!.text()).toContain('上游未确认启动结果'); expect(button('启动').disabled).toBe(false); expect(fixture!.starts).toHaveLength(1);
});

test('新 Agent 回执不抢走已返回的历史对话，成功清除新建输入而保留其他 Agent 草稿', async () => {
  fixture = historicalConversationFixture(); page = await renderApp(path); await edit(message(), '已有 Agent 的草稿');
  await page.click('新建 Agent'); await edit(prompt(), '新 Agent 指令'); await page.click('启动'); await backToRoster();
  expect(message().value).toBe('已有 Agent 的草稿'); await edit(message(), '已有 Agent 的后续草稿'); await finish(0);
  // 用户已主动返回 A 时，迟到成功不能又将输入目标切到刚创建的 Agent。
  expect(document.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toContain(historyAgentA.slice(-6));
  expect(message().value).toBe('已有 Agent 的后续草稿'); expect(document.activeElement).toBe(message()); expect(fixture!.starts).toHaveLength(1);
  await page.click('新建 Agent'); expect(prompt().value).toBe(''); expect(compute().value).toBe('');
  await backToRoster(); await page.click('返回 CLI 工作区'); expect(page.path()).toBe(path); expect(page.text()).toContain('历史对话输入有未保存的输入');
});

// 弹窗底部「清空」回到空白：首条指令与档位都清掉，弹窗不关。
test('新建 Agent 弹窗：清空回到空白、弹窗不关，不发启动', async () => {
  await open(); await edit(prompt(), '要清掉的指令'); await edit(compute(), '01a0bf5d-8f4b-7222-8222-222222222222');
  expect(document.querySelector('dialog[open] h2')?.textContent).toBe('新建 Agent');
  await act(async () => button('清空').click()); await page!.settle();
  expect(prompt().value).toBe(''); expect(compute().value).toBe(''); expect(document.querySelectorAll('dialog[open]').length).toBe(1); expect(fixture!.starts).toHaveLength(0);
});

test('停留新建表单时成功接续新 Agent，默认档位使用显式选择器且已发送输入不再阻挡离开', async () => {
  await open();
  // 权限不分档（D59）：表单里没有权限可选，请求里也不带。
  expect(document.querySelector('#agent-permission')).toBeNull();
  await edit(prompt(), '使用默认档位'); await page!.click('启动');
  expect(fixture!.starts[0]!.input).toEqual({ compute: { kind: 'default' }, prompt: '使用默认档位' }); await finish(0);
  expect(document.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toContain('ated-0'); expect(message().value).toBe('');
  await page!.click('返回 CLI 工作区'); expect(page!.path()).toBe(cliPath);
});
