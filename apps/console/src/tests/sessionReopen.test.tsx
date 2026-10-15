import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { activityProjectId } from './agentActivityFixture';
import { historicalConversationFixture } from './historicalConversationFixture';
import { renderDeliveryHarness } from './renderDeliveryHarness';

let fixture: ReturnType<typeof historicalConversationFixture> | undefined;
let page: Awaited<ReturnType<typeof renderDeliveryHarness>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; fixture?.restore(); fixture = undefined; });

test('释放结果在无会话时保留，重新开始开发后不再把新工作区显示为已释放', async () => {
  fixture = historicalConversationFixture(); fixture.agents.splice(0);
  const base = globalThis.fetch, endpoint = `/v1/projects/${activityProjectId}/dev-session`;
  const session = await (await base(endpoint)).json(), workspace = await (await base(`${endpoint}/workspace-status`)).json();
  const nextTaskId = '01a0bf5d-8f4b-71ae-81d1-f0c74fac0616';
  let closed = false, reopened = false;
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET';
    if (path.endsWith('/branches')) return Response.json({ items: [{ name: 'main', headSha: 'a'.repeat(40), isDefault: true, behindPreview: null, behindProd: null }] });
    if (path !== endpoint) return base(raw, init);
    if (method === 'DELETE') { closed = true; return Response.json({ session: { ...session, state: 'released' }, unpushed: [], workspace }); }
    if (method === 'POST') { closed = false; reopened = true; }
    return closed ? Response.json({ error: 'not_found', message: '没有开发会话' }, { status: 404 }) : Response.json({ ...session, taskId: reopened ? nextTaskId : session.taskId });
  }) as typeof fetch;
  page = await renderDeliveryHarness(`/projects/${activityProjectId}/dev-session?view=cli`);
  await page.click('释放会话'); await page.click('确认释放');
  expect(page.text()).toContain('会话已释放'); expect(page.text()).toContain('开始开发');
  await page.click('开始开发');
  expect(reopened).toBe(true); expect(page.text()).toContain('Bot 聊天');
  // 2026-10-15 正式验收：旧 mutation 结果曾横跨新 taskId，持续显示错误的释放状态。
  expect(page.text()).not.toContain('会话已释放');
  await page.click('Bot 聊天'); expect(page.text()).toContain('一起把想法做出来');
});
