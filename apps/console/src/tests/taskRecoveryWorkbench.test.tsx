import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { BusinessRecoveryAssessment, RequestBusinessRecovery } from '@crewstation/contracts';
import { TaskIdSchema, SubtaskIdSchema } from '@crewstation/contracts';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch, taskId = TaskIdSchema.parse('01900000-0000-7000-8000-000000000001'), childId = SubtaskIdSchema.parse('01900000-0000-7000-8000-000000000002');
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); });
function fixture() {
  const task = { id: taskId, serviceId: 'service', state: 'paused', generation: 2, image: 'registry/original@sha256:abc', labels: { name: '季度报告' }, createdAt: new Date().toISOString() };
  const target = { action: 'resume-task' as const, taskId, expectedGeneration: 2, materialDigest: 'a'.repeat(64), volumeUid: 'original-volume' };
  const assessment: BusinessRecoveryAssessment = { taskId, actions: [{ target, assessmentDigest: 'b'.repeat(64) }], reasons: [] };
  const posts: RequestBusinessRecovery[] = [], reads: string[] = [];
  const state = { fail: false, denied: false, delay: undefined as Promise<void> | undefined, requests: [] as Array<Record<string, unknown>> };
  const child = { id: childId, taskId, name: '生成图表', kind: 'agent', state: 'failed', process: 'exited', attempt: 1, error: { code: 'agent_failed', message: '工具执行失败' }, image: 'registry/agent@sha256:def', sessionId: 'original-session' };
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://console.test'), path = url.pathname;
    if (init?.method !== 'POST') reads.push(path + url.search);
    if (path === '/v1/me') return Response.json({ id: 'admin', name: '管理员', isAdmin: true, platformRole: 'admin', memberships: [] });
    if (path === '/v1/projects') return Response.json({ items: [{ id: 'project', name: '报表应用' }] });
    const root = '/v1/admin/business-execution/tasks';
    if (path === root) return Response.json({ items: [{ ...task, projectId: 'project', callerIdentity: 'report/app', protocol: 'v3', attention: 'none', failedSubtasks: 1, updatedAt: task.createdAt }] });
    if (state.denied && path.startsWith(root + '/')) return Response.json({ error: 'forbidden', message: '权限已撤销' }, { status: 403 });
    if (path.endsWith('/recovery/requests')) return Response.json({ items: state.requests });
    if (path.endsWith('/recovery')) {
      if (init?.method === 'POST') {
        const input = JSON.parse(String(init.body)); posts.push(input); if (state.delay) await state.delay;
        if (state.fail) return Response.json({ error: 'unavailable', message: '提交回执未取得' }, { status: 503 });
        const request = { ...input, id: 'request-one', state: 'pending', updatedAt: task.createdAt, createdAt: task.createdAt };
        state.requests = [request]; return Response.json(request, { status: 202 });
      }
      return Response.json(assessment);
    }
    if (path.startsWith(root + '/')) return Response.json({ task: { ...task, id: path.split('/').at(-1) }, subtasks: [child] });
    return Response.json({ items: [] });
  }) as typeof fetch;
  return { posts, reads, state, task, child, assessment, target };
}
async function selectTarget(value: string) {
  const select = document.querySelector<HTMLSelectElement>('dialog select')!;
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle();
}
test('真实任务详情在弹窗，确认前不提交；双击只一次，受理显示等待而非成功', async () => {
  const f = fixture(); page = await renderApp('/admin/business-execution'); await page.click('查看任务');
  expect(page.text()).toContain('registry/original@sha256:abc'); expect(f.posts).toHaveLength(0);
  await page.click('恢复任务'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(2); expect(f.posts).toHaveLength(0);
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('恢复原任务和工作卷');
  let release!: () => void; f.state.delay = new Promise<void>((resolve) => { release = resolve; });
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent === '确认执行')!;
  await act(async () => { confirm.click(); confirm.click(); }); expect(f.posts).toHaveLength(1);
  await act(async () => { release(); }); await page.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); expect(page.text()).toContain('等待应用认领');
  expect(page.text()).not.toContain('恢复操作已完成');
  expect(f.posts[0]).toMatchObject({ target: f.target, assessmentDigest: 'b'.repeat(64) }); expect(f.posts[0]).not.toHaveProperty('fence');
  f.state.requests[0]!.state = 'succeeded'; await page.reread(); expect(page.text()).toContain('恢复操作已完成');
});
test('子任务续跑显示原会话并提交所选目标，评估变化关闭确认权限且不降级fresh', async () => {
  const f = fixture(); page = await renderApp('/admin/business-execution'); await page.click('查看任务');
  f.assessment.actions = [{ assessmentDigest: 'c'.repeat(64), target: { taskId, action: 'resume-subtask', expectedGeneration: 2, materialDigest: 'a'.repeat(64), subtaskId: childId, expectedAttempt: 1, resumeSessionId: 'original-session' } }];
  await selectTarget(childId); expect(f.reads.some((r) => r.endsWith('?subtaskId=' + childId))).toBe(true);
  expect(page.text()).toContain('工具执行失败'); expect(page.text()).toContain('original-session');
  await page.click('继续原会话'); expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('不切换为新的会话');
  f.assessment.actions = []; f.assessment.reasons = ['original_session_incompatible']; await page.reread();
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent === '确认执行')!;
  expect(confirm.disabled).toBe(true); expect(page.text()).toContain('恢复条件已变化'); expect(f.posts).toHaveLength(0);
});
test('提交丢回执后关闭再打开仍沿用原键，失败不自动重发；后台记录可打开关联新任务', async () => {
  const f = fixture(); f.state.fail = true; page = await renderApp('/admin/business-execution'); await page.click('查看任务'); await page.click('恢复任务'); await page.click('确认执行');
  expect(page.text()).toContain('提交回执未取得'); expect(f.posts).toHaveLength(1);
  const cancel = async () => { await act(async () => { [...document.querySelectorAll('dialog[open]')].at(-1)!.dispatchEvent(new Event('cancel', { cancelable: true })); }); await page!.settle(); };
  await cancel(); await cancel(); await page.click('查看任务'); await page.click('恢复任务');
  f.state.fail = false; await page.click('确认执行'); expect(f.posts).toHaveLength(2); expect(f.posts[1]).toEqual(f.posts[0]);
  f.state.requests[0]!.state = 'succeeded'; f.state.requests[0]!.resultTaskId = 'new-task'; await page.reread(); await page.click('查看新任务');
  expect(f.reads).toContain('/v1/admin/business-execution/tasks/new-task'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
});
test('未接入、撤权与状态筛选展示真实原因，不开放必然失败的操作', async () => {
  const f = fixture(); f.assessment.actions = []; f.assessment.reasons = ['application_recovery_unsupported'];
  page = await renderApp('/admin/business-execution');
  const filter = document.querySelectorAll<HTMLSelectElement>('main select')[1]!;
  await act(async () => { filter.value = 'failed'; filter.dispatchEvent(new Event('change', { bubbles: true })); }); await page.settle();
  expect(f.reads.some((p) => p.includes('state=failed'))).toBe(true);
  await page.click('查看任务'); expect(page.text()).toContain('所属应用尚未接入任务恢复');
  expect([...document.querySelectorAll('dialog button')].some((b) => b.textContent === '恢复任务')).toBe(false);
  f.state.denied = true; await page.reread(); expect(page.text()).toContain('权限已撤销'); expect(f.posts).toHaveLength(0);
});
test('恢复失败和应用拒绝说明可理解，原始错误可展开查看', async () => {
  const f = fixture();
  f.state.requests = [{ id: 'failed', target: f.target, state: 'failed', reason: 'workspace_volume_changed', updatedAt: f.task.createdAt }];
  page = await renderApp('/admin/business-execution'); await page.click('查看任务');
  expect(page.text()).toContain('原工作卷已丢失或发生替换'); expect(page.text()).toContain('查看失败详情');
  f.state.requests[0]!.reason = 'unexpected_failure'; await page.reread(); expect(page.text()).toContain('恢复未完成，请查看失败详情');
  f.state.requests[0]!.state = 'rejected'; f.state.requests[0]!.reason = '应用已归档该报告'; await page.reread();
  expect(page.text()).toContain('应用拒绝'); expect(page.text()).toContain('应用已归档该报告'); expect(f.posts).toHaveLength(0);
});
test('恢复进度轮询完成后立即同步工作区状态与可用动作', async () => {
  const f = fixture();
  f.state.requests = [{ id: 'running', target: f.target, state: 'running', updatedAt: f.task.createdAt }];
  page = await renderApp('/admin/business-execution'); await page.click('查看任务');
  expect(page.text()).toContain('工作区：已暂停');
  f.task.state = 'running'; f.task.generation = 3;
  f.assessment.actions = []; f.assessment.reasons = ['task_not_recoverable'];
  f.state.requests[0]!.state = 'succeeded';
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2300)); }); await page.settle();
  expect(page.text()).toContain('恢复操作已完成');
  expect(page.text()).toContain('工作区：运行中');
  expect(page.text()).not.toContain('工作区：已暂停');
  expect(f.posts).toHaveLength(0);
});
