import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { WorkspaceStatusDtoSchema, CommitWorkspaceRequestSchema } from '@crewstation/contracts';
import { renderDeliveryHarness } from './renderDeliveryHarness';
import { projectCreationFixture, creationProjectId } from './projectCreationFixture';
import { summaryFixture, summaryFixtureItem } from './projectSummaryFixture';
import { releaseJourneyFixture, journeyId, taskId } from './releaseJourneyFixture';
import { projectId } from './releaseDeliveryFixture';
import { historicalConversationFixture } from './historicalConversationFixture';
import { activityProjectId } from './agentActivityFixture';
import { suggestProjectSlug } from '../features/projects/model/creation/suggestProjectSlug';
import { firstDeliveryPending, firstDeliveryState } from '../features/projects/model/delivery/firstDelivery';
import { isGuidedDevelopment, parseDevelopmentSearch } from '../shared/project/developmentSearch';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderDeliveryHarness>> | undefined, restore: (() => void) | undefined;
afterEach(() => { page?.unmount(); page = undefined; restore?.(); restore = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); });
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text);
async function input(selector: string, value: string) {
  const node = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector); if (!node) throw new Error(`Missing field ${selector}`);
  await act(async () => {
    node.focus(); const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  }); await page!.settle();
}
async function check(selector = 'input[type="checkbox"]') { await act(async () => { document.querySelector<HTMLInputElement>(selector)!.click(); }); await page!.settle(); }

test('域名建议可编辑，中文名稳定回退，空名不生成标识', () => {
  expect(suggestProjectSlug('Weekly Report', '12345678')).toBe('weekly-report');
  expect(suggestProjectSlug('团队周报助手', '12345678')).toBe('app-12345678');
  expect(suggestProjectSlug('2026 Report', '12345678')).toBe('app-2026-report');
  expect(suggestProjectSlug('A', '12345678')).toBe('app-a'); expect(suggestProjectSlug('AB', '12345678')).toBe('app-ab');
  expect(suggestProjectSlug('', '12345678')).toBe(''); expect(suggestProjectSlug('a'.repeat(100), '12345678')).toHaveLength(40);
});

test('新手入口明确进入引导，旧地址、文件、版本、参考与活动定位链接保留高级工作区语义', () => {
  expect(isGuidedDevelopment(parseDevelopmentSearch({}))).toBe(false);
  expect(isGuidedDevelopment(parseDevelopmentSearch({ view: 'guided' }))).toBe(true);
  for (const search of [{ target: 'prod' }, { file: 'app.ts' }, { topic: 'api' }, { task: 'task-id' }, { view: 'cli' }, { agent: 'agent-id' }]) {
    expect(isGuidedDevelopment(parseDevelopmentSearch(search))).toBe(false);
  }
});

test('首次交付区分开通、预览和正式就绪，未知槽不猜测未上线', () => {
  const item = summaryFixtureItem(); item.project.state = 'provisioning';
  expect(firstDeliveryPending(item)).toBe(false);
  expect(firstDeliveryState(item).current).toBe(1); item.project.state = 'active'; expect(firstDeliveryState(item).current).toBe(2);
  expect(firstDeliveryPending(item)).toBe(true);
  const slot = { name: 'preview' as const, active: false, releaseId: item.project.serviceId as never, tag: 'v0.1.0', commitSha: 'a'.repeat(40), host: 'app.test', state: 'ready' as const, replicas: 1, readyReplicas: 1 };
  item.slots = { status: 'ready', checkedAt: item.checkedAt, value: [slot] }; expect(firstDeliveryState(item).current).toBe(3);
  item.slots.value.push({ ...slot, name: 'prod', active: true }); expect(firstDeliveryState(item).current).toBe(4); expect(firstDeliveryPending(item)).toBe(false);
  item.checkedAt = new Date(0).toISOString(); expect(firstDeliveryState(item).production).toBeUndefined(); expect(firstDeliveryState(item).stage).toBe('unknown'); item.checkedAt = new Date().toISOString();
  item.slots = { status: 'unknown', checkedAt: item.checkedAt, reason: 'timeout' }; expect(firstDeliveryPending(item)).toBe(false); expect(firstDeliveryState(item).slotsKnown).toBe(false);
  const release = { id: item.project.serviceId as never, serviceId: item.project.serviceId!, tag: 'v0.1.0', commitSha: 'a'.repeat(40), branch: 'main', status: 'building' as const, createdBy: item.project.ownerUserId, createdAt: item.checkedAt, updatedAt: item.checkedAt };
  item.releases = { status: 'ready', checkedAt: item.checkedAt, value: [release] }; expect(firstDeliveryState(item).stage).toBe('release');
  item.releases.value[0] = { ...release, status: 'superseded' }; expect(firstDeliveryState(item).pendingRelease).toBeUndefined();
});

test('新建自动建议标识，手工修改后不覆盖；创建成功直接进入独立交付路由，刷新可接续', async () => {
  const f = projectCreationFixture('developer'); page = await renderDeliveryHarness('/projects'); await page.click('新建项目');
  await input('[name="name"]', 'Weekly Report'); expect(document.querySelector<HTMLInputElement>('[name="slug"]')?.value).toBe('weekly-report');
  await input('[name="slug"]', 'my-weekly'); await input('[name="name"]', 'Changed name'); expect(document.querySelector<HTMLInputElement>('[name="slug"]')?.value).toBe('my-weekly');
  await page.click('创建项目'); expect(f.writes()).toHaveLength(1); expect(page.path()).toBe(`/projects/${creationProjectId}/provisioning`);
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(0); expect(page.text()).toContain('正在准备项目环境'); expect(page.text()).not.toContain('正式应用已就绪');
  page.unmount(); page = await renderDeliveryHarness(`/projects/${creationProjectId}/provisioning`); expect(page.text()).toContain('正在准备项目环境'); expect(f.writes()).toHaveLength(1);
});

test('列表继续交付进入独立页面；诊断使用统一弹窗，关闭焦点回原按钮', async () => {
  const f = summaryFixture(); page = await renderDeliveryHarness('/projects');
  await page.click('继续交付'); expect(page.path()).toBe(`/projects/${f.item.project.id}/provisioning`);
  const trigger = button('环境诊断与恢复')!; trigger.focus(); await page.click('环境诊断与恢复');
  expect(document.querySelectorAll('dialog[open][data-cs-dialog]')).toHaveLength(1); expect(document.querySelector('table dialog')).toBeNull();
  await page.click('✕'); expect(document.activeElement === trigger).toBe(true);
});

test('概览保留开通故障优先级；开通后从首次交付接续开发，导航本身不启动任务', async () => {
  const f = summaryFixture(); f.item.project.state = 'failed'; page = await renderDeliveryHarness(`/projects/${f.item.project.id}`);
  const primary = () => document.querySelector('[data-primary-project-action]');
  expect(primary()?.textContent).toBe('查看开通问题'); f.item.role = 'developer'; await page.reread(); expect(primary()).toBeNull();
  f.item.role = 'owner'; f.item.project.state = 'active'; await page.reread(); expect(primary()?.textContent).toBe('继续交付');
  await page.click('继续交付'); await page.click('开始开发'); expect(page.path()).toBe(`/projects/${f.item.project.id}/dev-session`); expect(f.writes).toHaveLength(0);
});

test('验证需显式勾选；部署代次改变使原勾选失效', async () => {
  const f = releaseJourneyFixture(); page = await renderDeliveryHarness(`/projects/${projectId}/release/journeys/${journeyId}`);
  expect(button('验证通过，继续')?.disabled).toBe(true); await check(); expect(button('验证通过，继续')?.disabled).toBe(false);
  f.detail.continuation.targetRevision = 'd'.repeat(64); await page.reread(); expect(button('验证通过，继续')?.disabled).toBe(true); expect(f.writes).toHaveLength(0);
});

test('选择全部登录用户后先保存范围再上线；身份预览不会切换实际身份', async () => {
  const f = releaseJourneyFixture(); page = await renderDeliveryHarness(`/projects/${projectId}/release/journeys/${journeyId}`);
  await check(); await page.click('验证通过，继续'); await check('input[type="radio"][value="authenticated"]');
  await page.click('查看不同身份的访问结果'); await input('dialog select', 'guest'); expect(document.querySelector('dialog')?.textContent).toContain('先进入登录页');
  await page.click('✕'); expect(f.writes).toHaveLength(1); await page.click('确认将 v1.1.0 上线');
  expect(f.writes.map(write => write.path.split('/').at(-1))).toEqual(['verification', 'app-visibility', 'traffic-switch']);
  expect(f.delivery.visibility.mode).toBe('authenticated'); expect(f.writes[1]?.body).toMatchObject({ expectedRevision: 0, mode: 'authenticated' });
});

test('范围已保存但上线失败显示实际结果；别人的范围更新必须重核，不能写旧配置', async () => {
  const f = releaseJourneyFixture(); f.delivery.failSwitch = true; page = await renderDeliveryHarness(`/projects/${projectId}/release/journeys/${journeyId}`);
  await check(); await page.click('验证通过，继续'); await check('input[type="radio"][value="authenticated"]');
  f.delivery.visibility.revision = 1; await page.reread(); expect(button('确认将 v1.1.0 上线')?.disabled).toBe(true); expect(f.writes).toHaveLength(1);
  await page.click('重新核对'); await check('input[type="radio"][value="authenticated"]'); await page.click('确认将 v1.1.0 上线');
  expect(page.text()).toContain('访问范围已保存'); expect(page.text()).toContain('维护窗口已关闭'); expect(f.delivery.visibility.mode).toBe('authenticated');
});

test('发布前确认弹窗绑定任务、HEAD 和指纹，提交后重读干净版本才发构建', async () => {
  const f = releaseJourneyFixture(), base = globalThis.fetch; let head = 'a'.repeat(40), dirty = true;
  const workspace = () => WorkspaceStatusDtoSchema.parse({ status: 'ready', taskId, branch: 'main', headSha: head, fingerprint: 'c'.repeat(64), shallow: false, checkedAt: new Date().toISOString(), uncommitted: dirty ? [{ path: 'app.ts', status: '.M', index: '.', worktree: 'M' }] : [], uncommittedCount: dirty ? 1 : 0, uncommittedTruncated: false, unpushed: { status: 'ready', count: 0, commits: [], truncated: false }, upstream: { status: 'missing' } });
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://test').pathname;
    if (path.endsWith('/workspace-status')) return Response.json(workspace());
    if (path.endsWith('/workspace-commits')) { const body = CommitWorkspaceRequestSchema.parse(JSON.parse(String(init?.body))); f.writes.push({ path, body }); expect(body).toMatchObject({ expectedTaskId: taskId, expectedHead: head, expectedFingerprint: 'c'.repeat(64) }); head = 'd'.repeat(40); dirty = false; return Response.json({ taskId, branch: 'main', commitSha: head, workspace: workspaceWithoutTask(workspace()) }); }
    return base(raw, init);
  }) as typeof fetch;
  page = await renderDeliveryHarness(`/projects/${projectId}/release/publish?source=session`); await page.click('检查并提交 1 项改动');
  expect(document.querySelectorAll('dialog[data-cs-dialog]')).toHaveLength(1); expect(button('确认提交并构建')?.disabled).toBe(true);
  await input('dialog textarea', '完成周报界面'); await check('dialog input[type="checkbox"]'); await page.click('确认提交并构建');
  expect(f.writes.map(write => write.path.split('/').at(-1))).toEqual(['workspace-commits', 'publish']); expect(f.writes[1]?.body.expectedCommitSha).toBe('d'.repeat(40));
  expect(page.path()).toBe(`/projects/${projectId}/release/journeys/${journeyId}`);
});

test('简化开发页只在发送需求后启动默认 Agent，已有输出与实时预览同时可见', async () => {
  const f = historicalConversationFixture(); restore = f.restore; f.agents.splice(0); Object.assign(f.preview, { state: 'ready' });
  page = await renderDeliveryHarness(`/projects/${activityProjectId}/dev-session?view=guided`); expect(f.starts).toHaveLength(0); expect(page.text()).toContain('Bot 聊天');
  expect(document.querySelector('iframe[title="开发预览"]')).not.toBeNull();
  await input('textarea[aria-label]', '制作一个周报填写页面'); await page.click('发送'); expect(f.starts).toHaveLength(1); expect(f.starts[0]?.input).toEqual({ compute: { kind: 'default' }, prompt: '制作一个周报填写页面' });
  await act(async () => f.finishStart(0)); await page.settle(); expect(f.starts).toHaveLength(1);
});

test('权限读取失败禁用需求与预览控制，保留只读预览且不发写请求', async () => {
  const f = historicalConversationFixture(); restore = f.restore; f.agents.splice(0); Object.assign(f.preview, { state: 'ready' });
  const base = globalThis.fetch; let unavailable = false;
  globalThis.fetch = (async (raw, init) => unavailable && new URL(String(raw), 'http://test').pathname === `/v1/projects/${activityProjectId}`
    ? Response.json({ error: 'unavailable', message: '项目权限暂时无法确认' }, { status: 503 }) : base(raw, init)) as typeof fetch;
  page = await renderDeliveryHarness(`/projects/${activityProjectId}/dev-session?view=guided`); unavailable = true; await page.reread();
  expect(document.querySelector('iframe[title="开发预览"]')).not.toBeNull();
  expect(button('重启')?.disabled).toBe(true); expect(button('停止')?.disabled).toBe(true);
  await input('textarea[aria-label]', '不能发送'); await page.click('发送'); expect(f.starts).toHaveLength(0);
  expect(f.writes.filter(write => /\/preview\/(start|stop|restart)$/.test(write.path))).toHaveLength(0);
});

test('新手入口遇到失败直接展示原工作树恢复，不要求先理解高级工作区', async () => {
  const f = historicalConversationFixture(); restore = f.restore; f.sessionState.state = 'failed'; f.sessionState.message = 'OOMKilled';
  page = await renderDeliveryHarness(`/projects/${activityProjectId}/dev-session?view=guided`);
  expect(document.querySelector('section[data-state="failed"]')?.textContent).toContain('OOMKilled');
  expect(button('检查并恢复原工作树')).toBeDefined(); expect(document.querySelector('textarea[aria-label="发给 Agent 的消息"]')).toBeNull(); expect(f.starts).toHaveLength(0);
});
function workspaceWithoutTask(value: ReturnType<typeof WorkspaceStatusDtoSchema.parse>) { const { taskId: _task, ...workspace } = value; return workspace; }
