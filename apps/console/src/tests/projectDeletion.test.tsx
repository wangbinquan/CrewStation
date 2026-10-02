import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useState } from 'react';
import { messages } from '../features/projects/i18n/zh-CN';
import { ProjectDeletionDialog } from '../features/projects/components/ProjectDeletionDialog';
import { deletionPlanReady, deletionReviewRows } from '../features/projects/model/deletionReview';
import { dialogConfirmButton, openDialog, typeConfirmWord } from './confirmDialogDriver';
import { deletionOperation, deletionPlan, deletionProjectId } from './projectDeletionFixture';
import { renderElement } from './renderElement';

let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; });
const project = { id: deletionProjectId, name: '旧列表名称', slug: 'old-list-slug' };

test('只有原项目、未过期、完整 22 个所有者且无引用的盘点才能确认', () => {
  const plan = deletionPlan(); expect(deletionPlanReady(plan, project.id)).toBe(true);
  expect(deletionPlanReady(undefined, project.id)).toBe(false);
  expect(deletionPlanReady(plan, 'another-project')).toBe(false);
  expect(deletionPlanReady(plan, project.id, Date.parse(plan.expiresAt))).toBe(false);
  const missing = structuredClone(plan); missing.participants.pop(); expect(deletionPlanReady(missing, project.id)).toBe(false);
  const duplicate = structuredClone(plan); duplicate.participants[0] = duplicate.participants[1]!; expect(deletionPlanReady(duplicate, project.id)).toBe(false);
  for (const variant of ['partial', 'blocker', 'reference'] as const) {
    const blocked = structuredClone(plan), owner = blocked.participants[0]!;
    if (variant === 'partial') owner.complete = false;
    else if (variant === 'blocker') owner.blockers.push({ participant: 'project', code: 'busy', message: '仍有在途写入' });
    else owner.references.push({ kind: 'shared', id: 'other-reference', description: '其他项目仍在引用' });
    expect(deletionPlanReady(blocked, project.id)).toBe(false);
  }
  expect(deletionPlanReady({ ...plan, expiresAt: 'invalid' }, project.id)).toBe(false);
  expect(deletionPlanReady({ ...plan, complete: false }, project.id)).toBe(false);
  expect(deletionPlanReady({ ...plan, blockers: [{ participant: 'project', code: 'unknown', message: '来源不可读' }] }, project.id)).toBe(false);
});

test('资源盘点保留超过千条历史，不以分页或资源列表末项缺失解释为空', () => {
  const plan = deletionPlan(), last = plan.participants.at(-1)!;
  last.resources = Array.from({ length: 1001 }, (_, i) => ({ kind: 'history', id: `original-${i}`, identity: `uid-${i}`, count: 2 }));
  const rows = deletionReviewRows(plan); expect(rows.at(-1)?.resources).toHaveLength(1001);
  expect(rows.at(-1)?.resources.at(-1)?.id).toBe('original-1000'); expect(rows.at(-1)?.count).toBe(2002);
});

test('长列表末行两层统一弹窗：不先删除，Esc 只退回盘点，关闭保留列表、滚动和焦点', async () => {
  const plan = deletionPlan(); let accepted = 0;
  plan.participants.at(-1)!.resources = Array.from({ length: 50 }, (_, i) => ({ kind: 'volume', id: `original-volume-${i}`, identity: `uid-${i}`, count: 1 }));
  function List() {
    const [open, setOpen] = useState(false);
    return <><input aria-label="列表筛选" defaultValue="待验项目" />{Array.from({ length: 70 }, (_, i) => <p key={i}>项目 {i}</p>)}
      <button onClick={() => setOpen(true)}>删除末行项目</button>
      {open ? <ProjectDeletionDialog project={project} plan={plan} onReview={() => {}} onClose={() => setOpen(false)} onConfirm={async () => { accepted++; }} /> : null}</>;
  }
  page = await renderElement(<List />, messages); page.host.scrollTop = 700;
  const trigger = page.button('删除末行项目'); trigger.focus(); await page.click('删除末行项目');
  expect(openDialog().getAttribute('role')).toBe('dialog'); expect(openDialog().textContent).toContain('original-volume-49');
  expect(openDialog().textContent).toContain('原项目'); expect(openDialog().textContent).not.toContain('旧列表名称');
  page.button('继续删除…').focus(); await page.click('继续删除…'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
  expect(openDialog().getAttribute('role')).toBe('alertdialog'); expect(document.activeElement === openDialog().querySelector('input')).toBe(true);
  await typeConfirmWord('wrong'); expect(dialogConfirmButton().disabled).toBe(true); expect(accepted).toBe(0);
  await act(async () => { openDialog().dispatchEvent(new Event('cancel', { cancelable: true })); }); await page.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); expect(document.activeElement?.textContent).toBe('继续删除…');
  await page.click('关闭'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
  expect((page.host.querySelector('[aria-label="列表筛选"]') as HTMLInputElement).value).toBe('待验项目');
  expect(page.host.scrollTop).toBe(700); expect(document.activeElement === trigger).toBe(true); expect(accepted).toBe(0);
});

test('受理期间锁定两层、取消及重复提交；响应失败继续使用原计划', async () => {
  const plan = deletionPlan(); const accepted: string[] = []; let finish!: () => void;
  let hold = new Promise<void>((resolve) => { finish = resolve; });
  page = await renderElement(<ProjectDeletionDialog project={project} plan={plan} onReview={() => {}} onClose={() => { throw new Error('closed while busy'); }}
    onConfirm={async (selected) => { accepted.push(selected.id); await hold; throw new Error('private backend error'); }} />, messages);
  await page.click('继续删除…'); await typeConfirmWord(' DELETE '); await page.click('永久删除项目');
  expect(accepted).toEqual([plan.id]); expect(openDialog().querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
  await act(async () => { openDialog().querySelector('form')!.requestSubmit(); openDialog().dispatchEvent(new Event('cancel', { cancelable: true })); });
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(2); expect(accepted).toHaveLength(1);
  await act(async () => { finish(); }); await page.settle();
  expect(openDialog().textContent).toContain('同一个删除请求'); expect(openDialog().textContent).not.toContain('private backend error');
  hold = Promise.resolve(); await page.click('永久删除项目'); expect(accepted).toEqual([plan.id, plan.id]);
});

test('盘点在第二层打开后过期，会锁住已输入的确认词且不提交', async () => {
  const plan = deletionPlan(new Date(Date.now() + 250).toISOString()); let accepted = 0;
  page = await renderElement(<ProjectDeletionDialog project={project} plan={plan} onReview={() => {}} onClose={() => {}} onConfirm={async () => { accepted++; }} />, messages);
  await page.click('继续删除…'); await typeConfirmWord('delete'); expect(dialogConfirmButton().disabled).toBe(false);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  expect(dialogConfirmButton().disabled).toBe(true); await act(async () => { openDialog().querySelector('form')!.requestSubmit(); }); expect(accepted).toBe(0);
});

test('不完整盘点显示引用与阻塞，进度来自真实操作且仅阻塞时允许继续', async () => {
  const plan = deletionPlan(); plan.participants[0]!.references.push({ kind: 'consumer', id: 'shared', description: '另一项目引用源码' });
  plan.blockers.push({ participant: 'scm', code: 'source-unreadable', message: '源码来源暂时不可读' });
  page = await renderElement(<ProjectDeletionDialog project={project} plan={plan} onReview={() => {}} onClose={() => {}} onConfirm={async () => { throw new Error('must not submit'); }} />, messages);
  expect(page.button('继续删除…').disabled).toBe(true); expect(page.text()).toContain('另一项目引用源码'); expect(page.text()).toContain('源码来源暂时不可读');
  page.unmount(); let retries = 0; const operation = deletionOperation('needs-attention');
  page = await renderElement(<ProjectDeletionDialog project={project} operation={operation} onRetry={() => { retries++; }} onReview={() => {}} onClose={() => {}} onConfirm={async () => {}} />, messages);
  expect(page.text()).toContain(operation.id); expect(page.text()).toContain('停止运行并排空使用'); await page.click('继续清理'); expect(retries).toBe(1);
  page.unmount(); page = await renderElement(<ProjectDeletionDialog project={project} operation={deletionOperation('succeeded')} onReview={() => {}} onClose={() => {}} onConfirm={async () => {}} />, messages);
  expect(page.text()).toContain('独占资源已回收'); expect(page.host.querySelectorAll('button').length).toBe(2);
});
