import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useState } from 'react';
import type { AcceptProjectDeletion, ProjectDeletionOperation } from '@crewstation/contracts';
import type { ProjectDeletionsResource } from '@crewstation/api-client';
import { ProjectDeletionWorkflow } from '../features/projects/components/ProjectDeletionWorkflow';
import { messages } from '../features/projects/i18n/zh-CN';
import { dialogConfirmButton, openDialog, typeConfirmWord } from './confirmDialogDriver';
import { deletionOperation, deletionPlan, deletionProjectId } from './projectDeletionFixture';
import { renderElement } from './renderElement';

let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; sessionStorage.clear(); });
const userId = '01a0f30b-c652-7000-8d6f-553e3b5f6138';
const project = { id: deletionProjectId, name: '列表项目', slug: 'list-project' };
function fixture() {
  const calls: string[] = [], sent: AcceptProjectDeletion[] = [], plan = deletionPlan(); let found: ProjectDeletionOperation | undefined;
  const api: ProjectDeletionsResource = {
    find: async () => { calls.push('find'); return found; }, prepare: async () => { calls.push('prepare'); return plan; },
    accept: async (_id, input) => { calls.push('accept'); sent.push(structuredClone(input)); throw new Error('private lost response'); },
    get: async () => deletionOperation(), retry: async () => { calls.push('retry'); return deletionOperation(); },
    prepareReconfirmation: async () => { calls.push('reconfirmation-plan'); return { ...plan, operationId: deletionOperation().id, supersedes: plan.digest, digest: 'c'.repeat(64) }; },
    reconfirm: async (_id, input) => { calls.push('reconfirm'); sent.push(input); return { ...deletionOperation(), confirmationDigest: 'c'.repeat(64) }; },
  };
  return { api, calls, sent, plan, found: (value?: ProjectDeletionOperation) => { found = value; } };
}
function List({ resource }: { resource: ProjectDeletionsResource }) {
  const [open, setOpen] = useState(false);
  return <><input aria-label="项目筛选" defaultValue="原项目" />{Array.from({ length: 70 }, (_, i) => <p key={i}>项目 {i}</p>)}
    <button onClick={() => setOpen(true)}>删除末行</button><ProjectDeletionWorkflow project={project} userId={userId} open={open} resource={resource} onClose={() => setOpen(false)} /></>;
}

test('两次确认后失响应：关闭重载保留原请求，自动进度核对不新建删除，显式恢复沿同一键', async () => {
  const f = fixture(); page = await renderElement(<List resource={f.api} />, messages); page.host.scrollTop = 700;
  const trigger = page.button('删除末行'); trigger.focus(); await page.click('删除末行');
  expect(f.calls).toEqual(['find', 'prepare']); expect(openDialog().textContent).toContain('原项目');
  await page.click('继续删除…'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
  await typeConfirmWord('wrong'); expect(dialogConfirmButton().disabled).toBe(true); expect(f.sent).toHaveLength(0);
  await typeConfirmWord('delete'); await page.click('永久删除项目'); expect(f.sent).toHaveLength(1);
  expect(page.text()).toContain('原删除请求'); expect(page.text()).not.toContain('private lost response');
  expect(page.button('刷新进度')).toBeUndefined(); expect(f.sent).toHaveLength(1); expect(f.calls.filter((call) => call === 'prepare')).toHaveLength(1);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); await page.settle();
  expect(f.sent).toHaveLength(1); expect(f.calls.filter((call) => call === 'prepare')).toHaveLength(1);
  await page.click('关闭'); expect(page.host.scrollTop).toBe(700); expect(document.activeElement === trigger).toBe(true);
  expect((page.host.querySelector('[aria-label="项目筛选"]') as HTMLInputElement).value).toBe('原项目');
  page.unmount(); page = await renderElement(<List resource={f.api} />, messages); await page.click('删除末行');
  expect(f.calls.filter((call) => call === 'prepare')).toHaveLength(1); expect(page.host.textContent).toContain('原删除请求');
  f.api.accept = async (_id, input) => { f.sent.push(input); return deletionOperation(); };
  await page.click('核对原删除请求'); expect(f.sent).toHaveLength(2); expect(f.sent[1]).toEqual(f.sent[0]!);
  expect(page.text()).toContain('项目正在清理中'); expect(page.text()).not.toContain('项目已彻底删除');
});

test('重新盘点仍需两层确认；已有操作沿原操作确认，不发新删除', async () => {
  const f = fixture(); f.found(deletionOperation('needs-attention'));
  page = await renderElement(<List resource={f.api} />, messages); await page.click('删除末行');
  expect(f.calls).toEqual(['find']); await page.click('重新盘点并确认'); expect(f.calls).toEqual(['find', 'find', 'reconfirmation-plan']);
  await page.click('继续删除…'); await act(async () => { openDialog().dispatchEvent(new Event('cancel', { cancelable: true })); }); await page.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); expect(f.sent).toHaveLength(0);
  await page.click('继续删除…'); await typeConfirmWord('delete'); await page.click('永久删除项目');
  expect(f.calls.filter((call) => call === 'reconfirm')).toHaveLength(1); expect(f.calls).not.toContain('accept'); expect(f.calls).not.toContain('prepare');
  expect(page.text()).toContain('项目正在清理中');
});

test('缓存写入失败或错误用户的窗口不能重放其他人的原请求', async () => {
  const f = fixture(); page = await renderElement(<List resource={f.api} />, messages); await page.click('删除末行');
  await page.click('继续删除…'); await typeConfirmWord('delete');
  // happy-dom exposes bound Storage methods: override the configurable getter, not a stored key.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')!, storage = sessionStorage; let denied = 0;
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => storage.getItem(key), removeItem: (key: string) => storage.removeItem(key),
    setItem: () => { denied++; throw new Error('private storage unavailable'); },
  } });
  try { await page.click('永久删除项目'); } finally { Object.defineProperty(globalThis, 'sessionStorage', descriptor); }
  expect(denied).toBe(1);
  expect(f.sent).toHaveLength(0); expect(page.text()).toContain('无法保存原确认'); expect(page.text()).not.toContain('private storage unavailable');
  await page.click('永久删除项目'); expect(f.sent).toHaveLength(1);
  page.unmount(); page = await renderElement(<ProjectDeletionWorkflow project={project} userId="01a0f30b-c652-7000-8d6f-553e3b5f6139" open resource={f.api} onClose={() => {}} />, messages);
  expect(page.button('继续删除…').disabled).toBe(false); expect(page.host.textContent).not.toContain('核对原删除请求'); expect(f.sent).toHaveLength(1);
});

test('其他原操作的重新确认计划被拒绝，不呈现可以确认的第二层', async () => {
  const f = fixture(); f.found(deletionOperation('needs-attention'));
  f.api.prepareReconfirmation = async () => ({ ...f.plan, operationId: f.plan.id, supersedes: f.plan.digest, digest: 'c'.repeat(64) });
  page = await renderElement(<List resource={f.api} />, messages); await page.click('删除末行'); await page.click('重新盘点并确认');
  expect(page.text()).toContain('暂时无法核对服务器记录'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
  expect(page.host.textContent).not.toContain('继续删除…'); expect(f.sent).toHaveLength(0); expect(f.calls).not.toContain('accept'); expect(f.calls).not.toContain('reconfirm');
});

test('继续清理沿既有操作，轮询仍只读；服务器完成后才显示回收完成', async () => {
  const f = fixture(); f.found(deletionOperation('needs-attention'));
  page = await renderElement(<List resource={f.api} />, messages); await page.click('删除末行'); await page.click('继续清理');
  expect(f.calls).toEqual(['find', 'retry']); expect(page.text()).toContain('项目正在清理中'); expect(page.text()).not.toContain('项目已彻底删除');
  f.found(deletionOperation('succeeded')); await foregroundProgress();
  expect(page.text()).toContain('项目已彻底删除，独占资源已回收'); expect(f.sent).toHaveLength(0);
  expect(page.host.textContent).not.toContain('继续清理'); expect(page.host.textContent).not.toContain('重新盘点并确认');
});

test('原确认缓存损坏时仅能核对服务器记录，不发新盘点或无法绑定的重放', async () => {
  const f = fixture(); sessionStorage.setItem(`crewstation:project-deletion:v1:${userId}:${project.id}`, 'unreadable-private-record');
  page = await renderElement(<List resource={f.api} />, messages); await page.click('删除末行');
  expect(page.text()).toContain('原确认记录不可读'); expect(page.text()).not.toContain('unreadable-private-record');
  expect(page.host.textContent).not.toContain('核对原删除请求'); expect(page.host.textContent).not.toContain('继续删除…');
  expect(page.button('核对原删除请求')).toBeUndefined(); expect(page.button('继续删除…')).toBeUndefined();
  expect(page.button('刷新进度')).toBeUndefined(); await foregroundProgress(); expect(f.calls).toEqual(['find', 'find']); expect(f.sent).toHaveLength(0);
  f.found(deletionOperation('succeeded')); await foregroundProgress(); expect(page.text()).toContain('独占资源已回收'); expect(f.calls).not.toContain('prepare');
});

test('首次读取失败自动重查服务器；后台和关闭时暂停，盘点仍由明确操作触发', async () => {
  const f = fixture(); let failed = false;
  f.api.find = async () => { f.calls.push('find'); if (!failed) { failed = true; throw new Error('private initial read failed'); } return undefined; };
  page = await renderElement(<List resource={f.api} />, messages); await page.click('删除末行');
  expect(page.text()).toContain('系统会自动重试'); expect(f.calls).toEqual(['find']); expect(f.sent).toHaveLength(0); expect(page.button('刷新进度')).toBeUndefined();
  const descriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  try {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); await foregroundProgress(); expect(f.calls).toEqual(['find']);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); await foregroundProgress(); expect(f.calls).toEqual(['find', 'find']);
  } finally { if (descriptor) Object.defineProperty(document, 'visibilityState', descriptor); else delete (document as unknown as Record<string, unknown>)['visibilityState']; }
  expect(f.calls).not.toContain('prepare'); await page.click('重新盘点'); expect(f.calls).toEqual(['find', 'find', 'find', 'prepare']);
  await page.click('关闭'); const count = f.calls.length; await foregroundProgress(); expect(f.calls).toHaveLength(count); expect(f.sent).toHaveLength(0);
});

async function foregroundProgress() {
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); await page?.settle();
}
