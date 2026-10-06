import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useRef, useState } from 'react';
import type { ProjectDeletionRepairItem } from '@crewstation/contracts';
import { ProjectIdSchema, UserIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionsResource } from '@crewstation/api-client';
import { ProjectDeletionWorkflow } from '../features/projects/components/ProjectDeletionWorkflow';
import { messages } from '../features/projects/i18n/zh-CN';
import { deletionOperation, deletionPlan, deletionProjectId } from './projectDeletionFixture';
import { openDialog } from './confirmDialogDriver';
import { renderElement } from './renderElement';

let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; sessionStorage.clear(); });
const actor = UserIdSchema.parse(Bun.randomUUIDv7()), project = { id: ProjectIdSchema.parse(deletionProjectId), name: '原项目', slug: 'original' };
const item = (index: number): ProjectDeletionRepairItem => ({ owner: 'gateway', key: String(index), title: '完整旧记录 ' + index, originalDigest: 'a'.repeat(64), evidenceDigest: 'b'.repeat(64), facts: [{ label: '保留原文', value: '未知原归属保持' }], blockers: [], allowedDecisions: ['retain'], confirmed: null });
function fixture(count = 1) {
  const calls: string[] = []; const items = Array.from({ length: count }, (_, i) => item(i)); let fail = false, unreadable = false;
  const resource: ProjectDeletionsResource = {
    capabilities: async () => ({ available: true }), find: async () => undefined,
    prepare: async () => { calls.push('prepare'); const plan = deletionPlan(); return items.every((item) => item.confirmed) ? plan : { ...plan, complete: false, blockers: [{ participant: 'gateway', code: 'old', message: '旧归属待逐条核对' }] }; },
    accept: async () => { calls.push('accept'); return deletionOperation(); }, get: async () => deletionOperation(), retry: async () => deletionOperation(), prepareReconfirmation: async () => deletionPlan(), reconfirm: async () => deletionOperation(),
    repairItems: async () => { calls.push('read'); if (unreadable) throw new Error('private read failure'); return { version: 'operator-confirmed/v1', projectId: project.id, complete: true, items: structuredClone(items), blockers: [] }; },
    confirmRepair: async (_project, input) => { calls.push('confirm:' + input.key); if (fail && input.key === '1') throw new Error('private stale candidate'); const selected = items.find((item) => item.key === input.key)!; selected.confirmed = { decision: input.decision, actorId: actor, confirmedAt: '2026-10-06T00:00:00.000Z' }; return structuredClone(selected); },
  };
  return { resource, calls, items, fail: () => { fail = true; }, unreadable: () => { unreadable = true; } };
}
function List({ resource }: { resource: ProjectDeletionsResource }) {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null);
  return <><input aria-label="项目筛选" defaultValue="原筛选" />{Array.from({ length: 70 }, (_, i) => <p key={i}>项目 {i}</p>)}<button ref={trigger} onClick={() => setOpen(true)}>删除末行</button>
    <ProjectDeletionWorkflow project={project} userId={actor} open={open} resource={resource} returnFocusTo={trigger} onClose={() => setOpen(false)} /></>;
}
async function choose(index: number) { await act(async () => { openDialog().querySelectorAll<HTMLInputElement>('input[type="radio"]')[index]!.click(); }); await page!.settle(); }
async function cancelTop() { await act(async () => { openDialog().dispatchEvent(new Event('cancel', { cancelable: true })); }); await page!.settle(); }
const reviewLabel = '确认旧资源归属';
test('last-row repair opens a nested FormDialog, Esc preserves parent/filter/scroll/draft and a save only prepares a fresh plan before the existing second confirmation', async () => {
  const f = fixture(); page = await renderElement(<List resource={f.resource} />, messages); page.host.scrollTop = 800; const trigger = page.button('删除末行'); trigger.focus(); await page.click('删除末行');
  await page.click(reviewLabel); expect(document.querySelectorAll('dialog[open]')).toHaveLength(2); expect(openDialog().textContent).toContain('不会删除资源'); expect(page.button('保存已核对条目（0）').disabled).toBe(true);
  await choose(0); await cancelTop(); expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); expect(f.calls).not.toContain('accept');
  await page.click(reviewLabel); expect(openDialog().querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(true); await page.click('保存已核对条目（1）');
  expect(f.calls).toEqual(['prepare', 'read', 'read', 'confirm:0', 'prepare']); expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); expect(page.button('继续删除…').disabled).toBe(false);
  await page.click('继续删除…'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(2); expect(f.calls).not.toContain('accept'); await cancelTop(); await page.click('关闭');
  expect(page.host.scrollTop).toBe(800); expect(document.activeElement === trigger).toBe(true); expect((page.host.querySelector('[aria-label="项目筛选"]') as HTMLInputElement).value).toBe('原筛选');
});
test('source refresh invalidates old explicit choices; load failures cannot save a previous list; partial save preserves unsaved choices and refreshes preflight on close', async () => {
  const f = fixture(2); page = await renderElement(<List resource={f.resource} />, messages); await page.click('删除末行'); await page.click(reviewLabel); await choose(0);
  f.items[0]!.evidenceDigest = 'c'.repeat(64); await page.click('重读当前来源'); expect(page.button('保存已核对条目（0）').disabled).toBe(true); expect(openDialog().querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(false);
  await choose(0); await choose(1); f.fail(); await page.click('保存已核对条目（2）'); expect(openDialog().textContent).toContain('已保存 1 条确认'); expect(openDialog().textContent).not.toContain('private stale'); expect(f.calls).not.toContain('accept');
  await cancelTop(); expect(f.calls.filter((call) => call === 'prepare')).toHaveLength(2); await page.click(reviewLabel); expect(page.button('保存已核对条目（1）').disabled).toBe(false);
  f.unreadable(); await page.click('重读当前来源'); expect(openDialog().textContent).toContain('当前来源未能完整读取'); expect(page.button('保存已核对条目（0）').disabled).toBe(true);
});
