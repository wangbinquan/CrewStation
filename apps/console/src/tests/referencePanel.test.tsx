import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { activityProjectId } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { projectResourcesFixture, resourceEventTypes, resourceOperations, resourcesProjectId as id } from './projectResourcesFixture';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined, fixture: ReturnType<typeof editorWorkspaceFixture> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); fixture?.restore(); fixture = undefined; globalThis.fetch = originalFetch; });
const panel = () => document.querySelector<HTMLElement>('aside[aria-label="工具面板"]')!;
const panelTab = () => document.querySelector('[aria-label="工具面板"] [role="tab"][aria-selected="true"]')?.textContent;
const topicTab = () => document.querySelector('[role="tablist"][aria-label="资源主题"] [aria-selected="true"]')?.textContent;
async function chooseTopic(label: string) {
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="资源主题"] [role="tab"]')].find((node) => node.textContent === label)!.click()); await page!.settle();
}

test('没有会话时参考面板从主区打开：在旁是接口列表，放大后多出详情栏、申请记录与 Swagger，收起回到开会话表单', async () => {
  projectResourcesFixture(); page = await renderApp(`/projects/${id}/dev-session`);
  // RFC-020 D2：原「开发资源」整页没有了；没有会话也能打开参考面板，放大形态就是原来的整页。
  expect(panel().dataset.mode).toBe('closed'); expect(page.text()).toContain('打开参考');
  await page.click('打开参考'); expect(page.search()).toEqual({ view: 'reference' }); expect(panel().dataset.mode).toBe('side'); expect(topicTab()).toBe('调用接口');
  expect(page.text()).not.toContain('内嵌 Swagger');
  await page.click('放大查看全部'); expect(page.search()).toEqual({ view: 'reference', panel: 'full' }); expect(panel().dataset.mode).toBe('full'); expect(page.text()).toContain('内嵌 Swagger');
  await chooseTopic('运行环境'); expect(page.search()).toEqual({ view: 'reference', panel: 'full', topic: 'guide' }); expect(page.text()).toContain('CS_API_BASE');
  // 收起只改形态，主题留在地址里，再打开还是这一页。
  await page.click('收起'); expect(page.search()).toEqual({ view: 'cli', topic: 'guide' }); expect(panel().dataset.mode).toBe('closed'); expect(page.text()).toContain('打开参考');
});

test('有会话时参考面板与其他工具并列；事件主题的链接指向代码面板与投递页', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(`/projects/${activityProjectId}/dev-session?view=reference&topic=events`);
  expect(panelTab()).toBe('可使用资源'); expect(topicTab()).toBe('接收事件');
  const links = [...document.querySelectorAll('a')];
  expect(links.find((link) => link.textContent?.includes('打开订阅声明'))?.getAttribute('href')).toContain('file=crewstation.yaml');
  expect(links.find((link) => link.textContent?.includes('最近投递'))?.getAttribute('href')).toContain('tab=deliveries');
  await page.click('打开订阅声明'); expect(page.search()).toMatchObject({ view: 'code', file: 'crewstation.yaml' }); expect(panelTab()).toBe('代码');
  expect(fixture.commands.some((command) => command.type === 'readFile' && command.path === 'crewstation.yaml')).toBe(true);
});

const list = () => document.querySelector<HTMLElement>('[role="group"][aria-label="接口列表"]')!;
/** 平台接口来自另一份读取（能力说明），可能比目录晚到几拍。 */
async function listReady() { for (let attempt = 0; attempt < 10 && !document.querySelector('[role="group"][aria-label="接口列表"]')?.textContent?.includes('/business-tasks'); attempt++) await page!.settle(); }
const rowOf = (path: string) => [...list().querySelectorAll<HTMLLIElement>('li')].find((row) => row.textContent?.includes(path))!;
const groupTitles = (root: Element) => [...root.querySelectorAll('h3')].map((node) => node.firstElementChild?.textContent);
async function type(node: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => { node.focus(); Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
}

test('2026-09-23 接口列表：不出现操作 ID，可调用的（含平台接口）置顶、需申请的在分割线下，任何一行都不是宽表格', async () => {
  projectResourcesFixture(); page = await renderApp(`/projects/${id}/dev-session?view=reference`); await listReady();
  expect(panel().dataset.mode).toBe('side'); expect(document.querySelector('[aria-label="工具面板"] table')).toBeNull();
  for (const operation of resourceOperations) { expect(panel().textContent).not.toContain(operation.id); expect(panel().textContent).not.toContain(operation.proxyId); }
  expect(groupTitles(list())).toEqual(['可调用', '需申请']);
  const [callable, other] = [...list().querySelectorAll('section')];
  expect(callable!.textContent).toContain('/customers/{id}'); expect(callable!.textContent).toContain('/business-tasks'); expect(callable!.textContent).toContain('平台 · 业务子任务');
  expect(other!.textContent).toContain('/invoices'); expect(other!.textContent).not.toContain('/customers');
  // 可调用组里不再逐行重复「已可调」，需申请的只给按钮不挂同义标签。
  expect(callable!.querySelector('ul')!.textContent).not.toContain('已可调'); expect(other!.querySelector('ul')!.textContent).not.toContain('需申请');
  expect(page.text()).toContain('3 个接口');
});

test('点路径在行下展开调用地址（代码里就写这个），平台接口给平台 API 地址；搜索、提供方与状态筛选只作用于列表', async () => {
  projectResourcesFixture(); page = await renderApp(`/projects/${id}/dev-session?view=reference`); await listReady();
  await act(async () => rowOf('/invoices').querySelector<HTMLButtonElement>('button[aria-expanded]')!.click()); await page.settle();
  expect(rowOf('/invoices').textContent).toContain('${CS_INTERNAL_API_BASE}billing/invoices'); expect(rowOf('/invoices').textContent).toContain('获批后');
  await act(async () => rowOf('/business-tasks').querySelector<HTMLButtonElement>('button[aria-expanded]')!.click()); await page.settle();
  expect(rowOf('/business-tasks').textContent).toContain('${CS_PLATFORM_API_URL}/business-tasks');
  const search = list().parentElement!.querySelector<HTMLInputElement>('input[type="search"]')!;
  await type(search, '账单');
  expect(groupTitles(list())).toEqual(['需申请']); expect(page.text()).toContain('1 个接口');
  const [provider, status] = [...list().parentElement!.querySelectorAll<HTMLSelectElement>('select')];
  await type(search, '');
  await type(status!, 'callable'); expect(groupTitles(list())).toEqual(['可调用']);
  await type(provider!, 'platform'); expect(list().textContent).toContain('/business-tasks'); expect(list().textContent).not.toContain('/customers');
});

test('侧栏里「申请」打开申请弹窗、不在行下展开，取消关窗；不跳到放大形态', async () => {
  projectResourcesFixture(); page = await renderApp(`/projects/${id}/dev-session?view=reference`);
  const request = [...rowOf('/invoices').querySelectorAll('button')].find((node) => node.textContent === '申请')!;
  expect(request.getAttribute('aria-label')).toBe('申请定向开放 GET /invoices');
  await act(async () => request.click()); await page.settle();
  // 2026-09-23 起申请表单在弹窗里：行下不再展开表单，弹窗写清申请的是哪个操作。
  expect(rowOf('/invoices').querySelectorAll('textarea').length).toBe(0);
  expect(document.querySelector('dialog[open]')?.textContent).toContain('GET /invoices'); expect(panel().dataset.mode).toBe('side');
  await page.click('取消'); expect(document.querySelectorAll('dialog').length).toBe(0);
});

test('接收事件：已订阅在上；可订阅的按生产方、事件族归并，点一个类型复制可直接粘进 crewstation.yaml 的订阅片段', async () => {
  projectResourcesFixture();
  const clipboard = navigator.clipboard, writes: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { writes.push(value); } } });
  try {
    page = await renderApp(`/projects/${id}/dev-session?view=reference&topic=events`);
    const events = document.querySelector<HTMLElement>('[role="group"][aria-label="事件"]')!;
    // 推送请求带的头放在最后：先是订阅什么，再是收到什么。
    expect(groupTitles(events)).toEqual(['已订阅', 'gitlab 产生的事件', 'source 产生的事件', '推送请求带的头']);
    // 下线的类型不再给人订阅；族名下的子类型是按钮，产生方与所属项目不再逐行重复。
    expect(events.textContent).not.toContain('gitlab.tag'); expect(events.textContent).not.toContain('gitlab-event-producer');
    const open = events.querySelector<HTMLButtonElement>('button[aria-label="复制 gitlab.issue.open 的订阅片段"]')!;
    expect(open.textContent).toBe('open');
    await act(async () => open.click()); await page.settle();
    expect(writes).toEqual([`- eventTypeId: ${resourceEventTypes[1].id}  # gitlab.issue.open\n  handlerPath: /events/gitlab-issue-open\n`]);
    expect(page.text()).toContain('已复制 gitlab.issue.open 的订阅片段');
    // 本身就是类型的族名（gitlab.push）点族名复制；已订阅的类型（source.changed）带圆点。
    await act(async () => events.querySelector<HTMLButtonElement>('button[title="复制 gitlab.push 的订阅片段"]')!.click()); await page.settle();
    expect(writes[1]).toContain('# gitlab.push');
    expect(events.querySelector('[title="已订阅"]')).not.toBeNull();
  } finally { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard }); }
});
