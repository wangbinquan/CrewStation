import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { activityProjectId } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { projectResourcesFixture, resourcesProjectId as id } from './projectResourcesFixture';
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

test('没有会话时参考面板从主区打开：在旁只列已授权操作，放大后是完整目录与 Swagger，收起回到开会话表单', async () => {
  projectResourcesFixture(); page = await renderApp(`/projects/${id}/dev-session`);
  // RFC-020 D2：原「开发资源」整页没有了；没有会话也能打开参考面板，放大形态就是原来的整页。
  expect(panel().dataset.mode).toBe('closed'); expect(page.text()).toContain('打开参考');
  await page.click('打开参考'); expect(page.search()).toEqual({ view: 'reference' }); expect(panel().dataset.mode).toBe('side'); expect(topicTab()).toBe('API 接口');
  expect(page.text()).not.toContain('内嵌 Swagger');
  await page.click('放大查看全部'); expect(page.search()).toEqual({ view: 'reference', panel: 'full' }); expect(panel().dataset.mode).toBe('full'); expect(page.text()).toContain('内嵌 Swagger');
  await chooseTopic('平台接入'); expect(page.search()).toEqual({ view: 'reference', panel: 'full', topic: 'guide' }); expect(page.text()).toContain('CS_API_BASE');
  // 收起只改形态，主题留在地址里，再打开还是这一页。
  await page.click('收起'); expect(page.search()).toEqual({ view: 'cli', topic: 'guide' }); expect(panel().dataset.mode).toBe('closed'); expect(page.text()).toContain('打开参考');
});

test('有会话时参考面板与其他工具并列；事件主题的链接指向代码面板与投递页', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(`/projects/${activityProjectId}/dev-session?view=reference&topic=events`);
  expect(panelTab()).toBe('参考'); expect(topicTab()).toBe('事件');
  const links = [...document.querySelectorAll('a')];
  expect(links.find((link) => link.textContent?.includes('打开订阅声明'))?.getAttribute('href')).toContain('file=crewstation.yaml');
  expect(links.find((link) => link.textContent?.includes('最近投递'))?.getAttribute('href')).toContain('tab=deliveries');
  await page.click('打开订阅声明'); expect(page.search()).toMatchObject({ view: 'code', file: 'crewstation.yaml' }); expect(panelTab()).toBe('代码');
  expect(fixture.commands.some((command) => command.type === 'readFile' && command.path === 'crewstation.yaml')).toBe(true);
});
