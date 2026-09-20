import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { renderApp } from './renderApp';
import { testerSummaryFixture, trialMarketFixture } from './projectSummaryFixture';

const projectId = `prj_${'a'.repeat(32)}`, serviceId = `svc_${'b'.repeat(32)}`, userId = `usr_${'c'.repeat(32)}`, taskId = `tsk_${'d'.repeat(32)}`, releaseId = `rel_${'e'.repeat(32)}`;
const sha = 'a'.repeat(40), time = '2026-09-13T01:00:00.000Z', originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; focusManager.setFocused(undefined); onlineManager.setOnline(true); });
function fixture() {
  const state = { role: 'owner', admin: false, kind: 'DigitalWorker', dirty: false, noSession: false, workspaceError: 0, failBranches: false, failTags: false, failPublish: false, responseMismatch: false, releaseMissing: false, hold: undefined as Promise<void> | undefined, sha };
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [], reads: string[] = [];
  const release = { id: releaseId, serviceId, tag: 'v0.1.2', branch: 'main', commitSha: sha, status: 'pending', createdBy: userId, createdAt: time, updatedAt: time };
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET'; let body: unknown = { items: [] }, status = 200;
    if (method !== 'GET') {
      const input = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>; writes.push({ path, body: input }); await state.hold;
      if (state.failPublish) { status = 412; body = { error: 'precondition', message: '工作树 HEAD 已经变化，请重新确认发布来源', details: { uncommitted: ['刚刚修改.ts'] } }; }
      else { status = 202; release.commitSha = String(input.expectedCommitSha); body = { ...release, serviceId: state.responseMismatch ? `svc_${'f'.repeat(32)}` : serviceId }; }
    } else {
      reads.push(path);
      if (path === '/v1/me') body = { id: userId, name: '负责人', email: 'owner@test.invalid', platformRole: (state.admin) ? 'admin' : 'developer', isAdmin: state.admin, memberships: [{ projectId, role: state.role }] };
      else if (path === `/v1/market/apps/${projectId}`) body = trialMarketFixture(projectId);
      else if (path === `/v1/workbench/project-summaries/${projectId}`) body = testerSummaryFixture(projectId, serviceId);
      else if (path === `/v1/projects/${projectId}`) body = { id: projectId, serviceId, name: '演示应用', slug: 'demo', kind: state.kind, state: 'active', ownerUserId: userId };
      else if (path.endsWith('/branches')) { if (state.failBranches) { status = 503; body = { error: 'unavailable', message: '分支读取失败' }; } else body = { items: [{ name: 'main', headSha: state.sha, isDefault: true, behindPreview: null, behindProd: null }] }; }
      else if (path.endsWith('/workspace-status')) { if (state.workspaceError) { status = state.workspaceError; body = { error: status === 403 ? 'forbidden' : 'unavailable', message: '会话读取受阻' }; } else if (state.noSession) { status = 404; body = { error: 'not_found', message: '没有开发会话' }; } else body = { taskId, status: 'ready', branch: 'main', headSha: state.sha, shallow: false, fingerprint: 'fp', checkedAt: time, uncommittedCount: state.dirty ? 1 : 0, uncommittedTruncated: false, uncommitted: state.dirty ? [{ path: '未提交.ts', status: '.M', index: '.', worktree: 'M' }] : [], unpushed: { status: 'ready', commits: [], count: 0, truncated: false }, upstream: { status: 'missing' } }; }
      else if (path.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '没有开发会话' }; }
      else if (path.endsWith('/tags')) { if (state.failTags) { status = 503; body = { error: 'unavailable', message: '标签读取失败' }; } else body = { items: [{ name: 'v0.1.1', commitSha: sha, protected: true, createdAt: time }] }; }
      else if (path.startsWith('/v1/releases/')) { if (state.releaseMissing) { status = 404; body = { error: 'not_found', message: '发布记录不存在' }; } else body = release; }
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, writes, reads, release };
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => !node.closest('[hidden]') && node.textContent === label);
  expect(button).toBeDefined(); await act(async () => button!.click()); await page!.settle();
}
async function input(name: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
  expect(field).toBeDefined(); const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { field.focus(); Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
}
async function review() { await click('检查发布来源'); await click('确认版本'); }

test('离线确认发布不会排队到联网后自动发送，保留草稿供用户重新确认', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/release?source=repository`); await review();
  await input('version', 'v2.3.4'); await input('message', '离线保留的说明');
  await act(async () => window.dispatchEvent(new Event('offline'))); await page.settle();
  await click('确认发布到待验证版本'); expect(f.writes).toHaveLength(0);
  await act(async () => window.dispatchEvent(new Event('online'))); await page.settle();
  // 默认 mutation 队列曾在恢复联网时才发出离线期间点击的发布，绕过重新检查。
  expect(f.writes).toHaveLength(0); expect(page.text()).toContain('本次操作未发送'); expect(page.search().release).toBeUndefined();
  expect(page.text()).not.toContain('请核对发布历史');
  await review(); expect(document.querySelector<HTMLInputElement>('[name="version"]')?.value).toBe('v2.3.4');
  expect(document.querySelector<HTMLTextAreaElement>('[name="message"]')?.value).toBe('离线保留的说明');
  await click('确认发布到待验证版本'); expect(f.writes).toHaveLength(1); expect(page.search().release).toBe(releaseId);
});

test('发布已经发出后断网丢失回执，不声称未发送，也不会在联网后重复发布', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/release?source=repository`); await review();
  await input('message', '已发送但回执未知'); let reject: (error: Error) => void;
  f.state.hold = new Promise<void>((_resolve, fail) => { reject = fail; }); await click('确认发布到待验证版本'); expect(f.writes).toHaveLength(1);
  await act(async () => { window.dispatchEvent(new Event('offline')); reject!(new TypeError('回执连接已中断')); }); await page.settle();
  expect(page.text()).toContain('回执连接已中断'); expect(page.text()).toContain('请核对发布历史'); expect(page.text()).not.toContain('本次操作未发送');
  f.state.hold = undefined; await act(async () => window.dispatchEvent(new Event('online'))); await page.settle();
  expect(f.writes).toHaveLength(1); expect(page.search().release).toBeUndefined(); await review();
  expect(document.querySelector<HTMLTextAreaElement>('[name="message"]')?.value).toBe('已发送但回执未知'); expect(f.writes).toHaveLength(1);
});

test('尚无开发会话是可恢复空态，重复检查不报故障，也不自动创建或发布', async () => {
  const f = fixture(); f.state.noSession = true; page = await renderApp(`/projects/${projectId}/release?source=session`);
  // 实机无会话发布曾把正常 404 显示为读取故障，并引导去查看不存在的工作树改动。
  expect(page.text()).toContain('尚未开启开发会话'); expect(page.text()).not.toContain('读取失败');
  expect(page.text()).toContain('选择已推送分支发布');
  const entry = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((node) => node.textContent === '进入开发页');
  expect(entry?.getAttribute('href')).toBe(`/projects/${projectId}/dev-session`);
  await click('检查发布来源'); expect(page.text()).not.toContain('读取失败'); expect(page.text()).not.toContain('请核对发布历史'); expect(f.writes).toHaveLength(0);
  f.state.noSession = false; await review(); expect(page.text()).toContain(taskId); expect(page.text()).toContain(sha);
  expect(page.text()).not.toContain('尚未开启开发会话'); expect(f.writes).toHaveLength(0);
});

test('已确认会话消失后不沿用旧 HEAD，改用远端来源保留版本和说明', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/release?source=session`); await review();
  await input('version', 'v2.3.4'); await input('message', '保留发布说明'); f.state.noSession = true;
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
  const submit = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === '确认发布到待验证版本')!;
  expect(submit.disabled).toBe(true); await click('检查发布来源');
  expect(page.text()).toContain('尚未开启开发会话'); expect(page.text()).not.toContain(taskId); expect(f.writes).toHaveLength(0);
  await click('已推送分支'); await review();
  expect(document.querySelector<HTMLInputElement>('[name="version"]')?.value).toBe('v2.3.4'); expect(document.querySelector<HTMLTextAreaElement>('[name="message"]')?.value).toBe('保留发布说明');
  await click('确认发布到待验证版本'); expect(f.writes).toEqual([{ path: `/v1/services/${serviceId}/releases`, body: { branch: 'main', version: 'v2.3.4', expectedCommitSha: sha, message: '保留发布说明' } }]);
});

test.each([403, 503])('会话读取 %i 保留真实错误，不误报尚无会话，恢复后可重新检查', async (status) => {
  const f = fixture(); f.state.workspaceError = status; page = await renderApp(`/projects/${projectId}/release?source=session`);
  expect(page.text()).toContain('会话读取受阻'); expect(page.text()).not.toContain('尚未开启开发会话');
  await click('检查发布来源'); expect(page.text()).toContain('会话读取受阻'); expect(f.writes).toHaveLength(0);
  f.state.workspaceError = 0; await review(); expect(page.text()).toContain(sha); expect(f.writes).toHaveLength(0);
});

test('远端来源不需要开发会话；完整 SHA 经三步确认发送，202 定位实际发布而非宣称部署成功', async () => {
  const f = fixture(); f.state.noSession = true; page = await renderApp(`/projects/${projectId}/release`);
  await click('准备发布'); expect(f.writes).toHaveLength(0); expect(page.text()).toContain('只包含远端已推送提交');
  await review(); expect(page.text()).toContain(sha); expect(page.text()).toContain('生产数据'); expect(page.text()).toContain('v0.1.2');
  expect(f.reads.some((path) => path.endsWith('/workspace-status'))).toBe(false);
  await click('确认发布到待验证版本'); expect(f.writes).toEqual([{ path: `/v1/services/${serviceId}/releases`, body: { branch: 'main', version: 'patch', expectedCommitSha: sha } }]);
  expect(page.search().release).toBe(releaseId); expect(page.text()).toContain('排队中'); expect(page.text()).not.toContain('部署成功');
});

test('开发来源显示实际 dirty 清单；干净后携带任务与 SHA，冲突保留版本和说明并要求重新检查', async () => {
  const f = fixture(); f.state.dirty = true; page = await renderApp(`/projects/${projectId}/release?source=session`);
  expect(document.querySelector('[name="branch"]')).toBeNull(); await click('检查发布来源'); expect(page.text()).toContain('未提交.ts'); expect(f.writes).toHaveLength(0);
  f.state.dirty = false; await review(); await input('version', 'v2.3.4'); await input('message', '修复开发页'); f.state.failPublish = true;
  await click('确认发布到待验证版本'); expect(f.writes[0]).toEqual({ path: `/v1/projects/${projectId}/publish`, body: { branch: 'main', version: 'v2.3.4', expectedCommitSha: sha, expectedTaskId: taskId, message: '修复开发页' } });
  expect(page.text()).toContain('刚刚修改.ts'); expect(page.text()).toContain('重新检查来源');
  f.state.failPublish = false; f.state.sha = 'b'.repeat(40); await review();
  expect(document.querySelector<HTMLInputElement>('[name="version"]')?.value).toBe('v2.3.4'); expect(document.querySelector<HTMLTextAreaElement>('[name="message"]')?.value).toBe('修复开发页');
  await click('确认发布到待验证版本'); expect(f.writes[1]?.body.expectedCommitSha).toBe('b'.repeat(40)); expect(f.writes).toHaveLength(2);
});

test('全部字段约束、同时错误及焦点；重复标签不发送，返回与切换来源保留草稿', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/release?source=repository`); await review();
  expect(page.text()).toContain('最多 500 字'); expect(page.text()).toContain('major／minor／patch');
  await input('version', 'v01.0.0'); await input('message', '字'.repeat(501)); await click('确认发布到待验证版本');
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(2); expect(document.activeElement?.getAttribute('name')).toBe('version'); expect(f.writes).toHaveLength(0);
  await input('version', 'v0.1.1'); await input('message', '保留说明'); await click('确认发布到待验证版本'); expect(page.text()).toContain('该标签已存在'); expect(f.writes).toHaveLength(0);
  await click('上一步'); await click('上一步'); await click('当前开发会话'); expect(page.search().source).toBe('session'); await review();
  expect(document.querySelector<HTMLTextAreaElement>('[name="message"]')?.value).toBe('保留说明'); expect(document.querySelector<HTMLInputElement>('[name="version"]')?.value).toBe('v0.1.1');
});

test('来源或标签目录失败可恢复，失败不当作无分支，标签未知时不能发布', async () => {
  const f = fixture(); f.state.failBranches = true; page = await renderApp(`/projects/${projectId}/release?source=repository`);
  expect(page.text()).toContain('分支读取失败'); await click('检查发布来源'); expect(f.writes).toHaveLength(0);
  f.state.failBranches = false; await click('检查发布来源'); await click('确认版本');
  f.state.failTags = true; await page.navigate(`/projects/${projectId}`); await page.navigate(`/projects/${projectId}/release?source=repository`); await review();
  expect(page.text()).toContain('标签读取失败'); const submit = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '确认发布到待验证版本')!; expect(submit.disabled).toBe(true);
  f.state.failTags = false; await click('重读标签'); expect(page.text()).toContain('v0.1.2'); expect(submit.disabled).toBe(false); expect(f.writes).toHaveLength(0);
});

test('在途只提交一次，离开后的回执不会把用户拉回发布页；错误服务回执不标成功', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/release?source=repository`); await review();
  let release: () => void; f.state.hold = new Promise<void>((resolve) => { release = resolve; });
  const form = document.querySelector<HTMLFormElement>('form[aria-label="发布准备"]')!;
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await page.settle(); expect(f.writes).toHaveLength(1);
  await page.requestNavigate(`/projects/${projectId}`); await click('放弃输入并离开'); expect(page.path()).toBe(`/projects/${projectId}`);
  await act(async () => release!()); await page.settle(); expect(page.path()).toBe(`/projects/${projectId}`);
  f.state.hold = undefined; f.state.responseMismatch = true; await page.navigate(`/projects/${projectId}/release?source=repository`); await review(); await click('确认发布到待验证版本');
  expect(page.search().release).toBeUndefined(); expect(page.text()).toContain('返回的服务或提交无法确认');
});

test('关闭准备与切项目先确认，取消保留草稿；测试者不能发布', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/release?source=repository`); await review(); await input('message', '未保存的发布说明');
  await click('收起准备'); expect(page.text()).toContain('未保存'); await click('继续编辑'); expect(document.querySelector<HTMLTextAreaElement>('[name="message"]')?.value).toBe('未保存的发布说明');
  await page.requestNavigate(`/projects/${projectId}`); await click('放弃输入并离开'); expect(f.writes).toHaveLength(0);
  f.state.role = 'tester'; page.unmount(); f.reads.length = 0; page = await renderApp(`/projects/${projectId}/release?source=repository`); expect(page.text()).toContain('Beta');
  expect(document.querySelector('form[aria-label="发布准备"]') === null).toBe(true);
  expect(f.reads.some((path) => /\/branches|\/tags|\/workspace-status/.test(path))).toBe(false);
});

test('指定的未知发布不替换为最新记录；详情与日志保持管理空间和精确 ID', async () => {
  const f = fixture(); f.state.admin = true; f.state.kind = 'APIProxy'; f.state.releaseMissing = true;
  page = await renderApp(`/admin/integrations/${projectId}/release?release=${releaseId}`); expect(page.text()).toContain('发布记录不存在'); expect(page.text()).not.toContain('v0.1.2');
  f.state.releaseMissing = false; await click('刷新发布'); expect(page.text()).toContain('排队中');
  await page.click('本次迁移日志'); expect(page.path()).toBe(`/admin/integrations/${projectId}/operations`); expect(page.search()).toMatchObject({ tab: 'logs', source: 'migration', releaseId });
});

test('重新回到页面发现远端 SHA 改变时旧确认立即失效，不把新提交静默装进请求', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/release?source=repository`); await review();
  f.state.sha = 'b'.repeat(40); await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
  expect(page.text()).toContain('检查后的来源已变化'); const submit = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === '确认发布到待验证版本')!; expect(submit.disabled).toBe(true);
  await click('检查发布来源'); await review(); expect(page.text()).toContain('b'.repeat(40)); expect(f.writes).toHaveLength(0);
});
