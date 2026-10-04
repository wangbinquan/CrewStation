// Finite formal-API display fixtures: a whole usage gap must not erase qualified Task bins.
import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {act} from 'react';
import {CompleteRuntimeTaskSummarySchema} from '@crewstation/contracts';
import {renderApp} from './renderApp';
import {runtimeSealedFactsFixture} from './runtimeSealedFactsFixture';
let page:Awaited<ReturnType<typeof renderApp>>|undefined;const originalFetch=globalThis.fetch;
afterEach(()=>{page?.unmount();page=undefined;globalThis.fetch=originalFetch;});
const metrics={state:'ready' as const,tokens:{input:'3',cacheRead:'9',cacheWrite:'15',output:'21',total:'48'},executions:'1',observedExecutions:'1',records:'1',cost:{currency:'CNY' as const,state:'complete' as const,amount:'0.0002235'}};
test.each(['system','project'] as const)('%s keeps exact sibling bins and CNY on the final Task page and preserves the list on return',async scope=>{
 const f=runtimeSealedFactsFixture();f.tasks[200]=CompleteRuntimeTaskSummarySchema.parse({...f.tasks[200]!,metrics});const root=scope==='system'?'/admin/observability':'/projects/'+f.projectId+'/observability';page=await renderApp(root+'?'+f.query);
 expect(document.querySelector('[data-runtime-metrics]')).not.toBeNull();expect(document.querySelector('[data-runtime-metrics]')?.textContent).not.toContain('¥');expect([...document.querySelectorAll('[data-runtime-metrics] [data-token-bucket] dd')].map(row=>row.textContent)).toEqual(['—','—','—','—']);await page.click('任务明细');const first=document.querySelector('[data-runtime-task-id="'+f.tasks[0]!.id+'"]')!;expect(first.textContent).not.toContain('¥');
 await page.click('下一页');await page.click('下一页');expect(document.querySelectorAll('[data-runtime-task-id]')).toHaveLength(1);const last=document.querySelector('[data-runtime-task-id]')!;expect(last.textContent).toContain('48');expect(last.textContent).toContain('¥0.0002235');expect([...last.querySelectorAll('[data-token-bucket] dd')].map(row=>row.textContent)).toEqual(['3','9','15','21']);expect(page.text()).toContain('总计 201 条');
 await page.click('Sealed Task 200');expect(document.querySelector('[data-runtime-task]')?.textContent).toContain('¥0.0002235');expect([...document.querySelectorAll('[data-runtime-task] [data-token-bucket] dd')].slice(0,4).map(row=>row.textContent)).toEqual(['3','9','15','21']);
 await page.click('返回统计列表');await act(async()=>{await new Promise(resolve=>requestAnimationFrame(resolve));});expect(document.querySelectorAll('[data-runtime-task-id]')).toHaveLength(1);expect(document.activeElement?.textContent).toBe('Sealed Task 200');expect(document.querySelector('[data-runtime-task-id]')?.textContent).toContain('¥0.0002235');const overview=[...document.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(tab=>tab.textContent==='总览')!;expect(overview).toBeDefined();await act(async()=>overview.click());await page.settle();expect(document.querySelector('[data-runtime-metrics]')).not.toBeNull();expect(document.querySelector('[data-runtime-metrics]')?.textContent).not.toContain('¥');expect([...document.querySelectorAll('[data-runtime-metrics] [data-token-bucket] dd')].map(row=>row.textContent)).toEqual(['—','—','—','—']);
});
test('a failed next page revokes previously visible exact Task metrics together with the matching report',async()=>{
 const f=runtimeSealedFactsFixture();f.tasks[0]=CompleteRuntimeTaskSummarySchema.parse({...f.tasks[0]!,metrics});page=await renderApp('/admin/observability?tab=tasks&'+f.query);expect(page.text()).toContain('¥0.0002235');f.controls.failedPage=true;await page.click('下一页');expect(page.text()).toContain('原报告明细未能完整核对');expect(document.querySelectorAll('[data-runtime-task-id]')).toHaveLength(0);expect(page.text()).not.toContain('¥0.0002235');expect(document.querySelector('[data-runtime-metrics]')).toBeNull();
});
