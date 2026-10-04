// RFC-034: usage gaps must preserve every independently sealed task and its execution timeline.
import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {act} from 'react';
import {renderApp} from './renderApp';
import {openDialog} from './confirmDialogDriver';
import {runtimeSealedFactsFixture} from './runtimeSealedFactsFixture';
let page:Awaited<ReturnType<typeof renderApp>>|undefined;
const originalFetch=globalThis.fetch;
afterEach(()=>{page?.unmount();page=undefined;globalThis.fetch=originalFetch;});
test.each(['system','project'] as const)('%s preserves all 201 tasks, exact timing and four unknown bins through task drill and return',async scope=>{
 const f=runtimeSealedFactsFixture(),root=scope==='system'?'/admin/observability':'/projects/'+f.projectId+'/observability';page=await renderApp(root+'?'+f.query);
 expect(page.text()).toContain('Token 用量存在缺口');expect(page.text()).toContain('继续等待不会自动补齐');expect(page.text()).toContain('201');expect(page.text()).toContain('Original Execution Project');
 expect([...document.querySelectorAll('[data-runtime-metrics] [data-token-bucket] dd')].map(row=>row.textContent)).toEqual(['—','—','—','—']);expect(document.querySelector('[data-runtime-metrics]')?.textContent).not.toContain('¥');
 const trend=document.querySelector('[aria-label="任务与 Token 趋势"]');expect(trend).not.toBeNull();expect(trend?.querySelector('button')?.getAttribute('aria-label')).toContain('201');expect(document.querySelector('[aria-label="当前趋势区间"]')?.textContent).toContain('201');
 await page.click('任务明细');expect(document.querySelectorAll('[data-runtime-task-id]')).toHaveLength(100);await page.click('下一页');expect(document.querySelectorAll('[data-runtime-task-id]')).toHaveLength(100);await page.click('下一页');expect(document.querySelectorAll('[data-runtime-task-id]')).toHaveLength(1);expect(page.text()).toContain('总计 201 条');
 const list=document.querySelector('main')!;list.scrollTop=510;await page.click('Sealed Task 200');const reportId=page.search().reportId;expect(page.path()).toContain('/tasks/'+f.tasks[200]!.id);expect(page.text()).toContain('Original Execution Project');expect(page.text()).toContain('Original Agent 200');expect(page.text()).toContain('Original Compute · r7');expect(page.text()).toContain('Agent 执行泳道');expect(page.text()).toContain('10.0 s');
 expect(document.querySelector('[data-runtime-task]')?.textContent).not.toContain('¥');expect(f.reads.some(row=>['calls','captures','models'].includes(row.section))).toBe(false);
 const bar=document.querySelector<HTMLButtonElement>('[aria-label="Original Agent 200 · 第 1 次 · 10.0 s"]')!;bar.focus();await act(async()=>bar.click());await page.settle();expect(openDialog().textContent).toContain('Original Compute');expect(openDialog().textContent).not.toContain('¥');await act(async()=>openDialog().dispatchEvent(new Event('cancel',{cancelable:true})));await page.settle();expect(document.activeElement).toBe(bar);
 await page.click('返回统计列表');await act(async()=>{await new Promise(resolve=>requestAnimationFrame(resolve));});expect(document.querySelectorAll('[data-runtime-task-id]')).toHaveLength(1);expect(document.activeElement?.textContent).toBe('Sealed Task 200');expect(list.scrollTop).toBe(510);expect(page.search().reportId).toBe(reportId);
 expect(f.reads.filter(row=>row.section==='tasks'&&row.parent===null).some(row=>row.after==='200'&&row.count===1)).toBe(true);
});
test.each(['agents','usage'] as const)('%s sealed contributions retain all 201 tasks and restore their final page and shared dialog focus',async tab=>{
 const f=runtimeSealedFactsFixture();page=await renderApp('/admin/observability?tab='+tab+'&'+f.query);const label=tab==='agents'?'Original Agent':'Original Compute · r7';await page.click(label);expect(openDialog().textContent).toContain('201');expect(openDialog().querySelectorAll('[data-token-bucket] dd')).toHaveLength(404);expect(openDialog().textContent).not.toContain('¥');await page.click('下一页');await page.click('下一页');expect(openDialog().querySelectorAll('[data-runtime-task-id]')).toHaveLength(1);
 const body=openDialog().firstElementChild!.children[1] as HTMLElement;body.scrollTop=240;await page.click('Sealed Task 200');await page.click('返回统计列表');await act(async()=>{await new Promise(resolve=>requestAnimationFrame(resolve));});expect(openDialog().querySelectorAll('[data-runtime-task-id]')).toHaveLength(1);expect(document.activeElement?.textContent).toBe('Sealed Task 200');expect((openDialog().firstElementChild!.children[1] as HTMLElement).scrollTop).toBe(240);await act(async()=>openDialog().dispatchEvent(new Event('cancel',{cancelable:true})));await page.settle();expect(document.activeElement?.textContent).toBe(label);
});
test('a missing original retained page revokes the matching report facts and every summary',async()=>{
 const f=runtimeSealedFactsFixture();page=await renderApp('/admin/observability?tab=tasks&'+f.query);expect(document.querySelectorAll('[data-runtime-task-id]')).toHaveLength(100);f.controls.failedPage=true;await page.click('下一页');expect(page.text()).toContain('原报告明细未能完整核对');expect(document.querySelectorAll('[data-runtime-task-id]')).toHaveLength(0);expect(document.querySelector('[data-runtime-metrics]')).toBeNull();expect(document.querySelector('[aria-label="任务与 Token 趋势"]')).toBeNull();expect(page.text()).not.toContain('Token 用量存在缺口');
});
test('a changed original page snapshot revokes the facts instead of rendering a mixed report',async()=>{
 const f=runtimeSealedFactsFixture();f.controls.brokenSnapshot=true;page=await renderApp('/admin/observability?tab=tasks&'+f.query);expect(page.text()).toContain('原报告明细未能完整核对');expect(document.querySelectorAll('[data-runtime-task-id]')).toHaveLength(0);
});
test('quality remains visible with real task association while token gaps withhold all numerical usage',async()=>{
 const f=runtimeSealedFactsFixture();page=await renderApp('/admin/observability?tab=performance&'+f.query);expect(page.text()).toContain('Sealed Task 0');expect(page.text()).toContain('20.0 s');expect(f.reads.some(row=>row.section==='quality'&&row.parent===null&&row.count===1)).toBe(true);expect(page.text()).not.toContain('¥');
});

test.each(['system','project'] as const)('%s source rows never claim complete usage when only execution facts are sealed',async scope=>{
 const f=runtimeSealedFactsFixture(),root=scope==='system'?'/admin/observability':'/projects/'+f.projectId+'/observability';page=await renderApp(root+'?'+f.query);
 const source=document.querySelector('[data-runtime-source="business-task"]')!;expect(source).not.toBeNull();expect(source.textContent).toContain('201');expect(source.textContent).toContain('执行记录已核对，用量有缺口');expect(source.textContent).not.toContain('已知用量完整');expect(source.textContent).not.toContain('¥');
});
