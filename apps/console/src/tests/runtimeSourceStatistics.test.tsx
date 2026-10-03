import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { openDialog } from './confirmDialogDriver';
import { runtimeSourceStatisticsFixture,sourceTaskButton } from './runtimeSourceStatisticsFixture';
import { parseRuntimeSearch } from '../features/observability/model/runtimeSearch';
import { runtimeReturnKey } from '../features/observability/hooks/useRuntimeListReturn';
let page:Awaited<ReturnType<typeof renderApp>>|undefined;
const originalFetch=globalThis.fetch;
afterEach(()=>{page?.unmount();page=undefined;globalThis.fetch=originalFetch;});
test('both levels show direct purpose controls, actual token labels and explicit disabled collection',async()=>{
  const f=runtimeSourceStatisticsFixture();
  for(const root of ['/admin/observability','/projects/'+f.projectId+'/observability']){
    page=await renderApp(root+'?'+f.query);expect(page.text()).toContain('用途与消耗');expect(page.text()).toContain('开发生产采集未开启');expect(page.text()).toContain('9,007,199,254,741,200');
    expect(page.text()).toContain('任务 / 开发执行');expect(page.text()).not.toContain('CSV');expect(page.text()).not.toContain('更多筛选');expect(document.querySelectorAll('[data-runtime-source]')).toHaveLength(2);
    await page.click('开发 Agent');expect(page.search().sourceKind).toBe('development-agent');expect(page.text()).toContain('9,007,199,254,741,000');
    expect(f.reads.filter(read=>read.includes('/statistics')).at(-1)).toContain('sourceKind=development-agent');expect(document.querySelector<HTMLButtonElement>('[aria-label="用途与消耗"] [aria-pressed="true"]')?.textContent).toBe('开发 Agent');
    await page.click('全部用途');expect(page.search().sourceKind).toBeUndefined();page.unmount();page=undefined;
  }
});
test('last development route returns source range, scroll and row focus; unknown timing stays unknown',async()=>{
  const f=runtimeSourceStatisticsFixture(),last=f.development.at(-1)!;page=await renderApp('/admin/observability?tab=tasks&sourceKind=development-agent&'+f.query);
  const main=document.querySelector('main')!;main.scrollTop=350;await act(async()=>sourceTaskButton(last.id).click());await page.settle();
  expect(page.path()).toBe('/admin/observability/tasks/'+last.id);expect(page.text()).toContain('父工作区');expect(page.text()).toContain('名称暂不可用');expect(page.text()).toContain('Accepted Dev Compute');expect(page.text()).toContain('活动区间尚未采集');
  expect(page.text()).not.toContain('0 ms');await page.click('返回统计列表');await act(async()=>{await new Promise(resolve=>requestAnimationFrame(resolve));});
  expect(page.search()).toMatchObject({sourceKind:'development-agent',tab:'tasks',from:f.from,to:f.to});expect(main.scrollTop).toBe(350);expect(document.activeElement).toBe(sourceTaskButton(last.id));
});
test('accepted compute dialog retains both exact contributions and source context',async()=>{
  const f=runtimeSourceStatisticsFixture();page=await renderApp('/admin/observability?tab=usage&sourceKind=development-agent&'+f.query);
  const trigger=[...document.querySelectorAll<HTMLButtonElement>('tbody button')].find(b=>b.textContent==='Accepted Dev Compute · r7')!;trigger.focus();await act(async()=>trigger.click());await page.settle();
  expect(openDialog().textContent).toContain('9,007,199,254,741,000');expect(openDialog().textContent).toContain('9,007,199,254,740,993');expect(openDialog().textContent).toContain('开发 Agent');
  await act(async()=>openDialog().dispatchEvent(new Event('cancel',{cancelable:true})));await page.settle();expect(document.activeElement).toBe(trigger);expect(page.search().sourceKind).toBe('development-agent');
});
test('admin project view keeps hidden amounts in groups, compute contribution and execution detail',async()=>{
  const f=runtimeSourceStatisticsFixture();page=await renderApp('/projects/'+f.projectId+'/observability?tab=usage&sourceKind=development-agent&'+f.query);
  expect(page.text()).not.toContain('¥');await page.click('Accepted Dev Compute · r7');expect(openDialog().textContent).not.toContain('¥');
  await act(async()=>openDialog().querySelector<HTMLButtonElement>('tbody button')!.click());await page.settle();expect(page.text()).not.toContain('¥');expect(page.text()).toContain('项目尚未开放费用查看');
});
test('source URL validation and return keys isolate source-specific cached views',()=>{
  expect(parseRuntimeSearch({sourceKind:'development-agent'})).toEqual({sourceKind:'development-agent'});expect(parseRuntimeSearch({sourceKind:'development-cli'})).toEqual({});
  expect(runtimeReturnKey('p',{sourceKind:'development-agent'})).not.toBe(runtimeReturnKey('p',{sourceKind:'business-task'}));
});

test('empty disabled development buckets stay unknown while native proven zero stays a real zero',async()=>{
  const f=runtimeSourceStatisticsFixture({development:false});page=await renderApp('/admin/observability?'+f.query);
  const empty=document.querySelector('[data-runtime-source="development-agent"]')!;expect([...empty.querySelectorAll('td')].slice(2,7).map(cell=>cell.textContent)).toEqual(['—','—','—','—','—']);
  page.unmount();page=undefined;const known=runtimeSourceStatisticsFixture({zero:true});page=await renderApp('/admin/observability?sourceKind=development-agent&'+known.query);
  const zero=document.querySelector('[data-runtime-source="development-agent"]')!;expect([...zero.querySelectorAll('td')].slice(2,7).map(cell=>cell.textContent)).toEqual(['0','0','0','0','0']);
  expect(known.development.every(r=>r.attempts[0]?.nativeCaptures?.[0]?.proof.steps===0)).toBe(true);
});
test('project and system lists retain each original compute name and revision, including overview rows',async()=>{
  const f=runtimeSourceStatisticsFixture({differentCompute:true});
  for(const root of ['/admin/observability','/projects/'+f.projectId+'/observability'])for(const tab of ['overview','tasks']){
    page=await renderApp(root+'?tab='+tab+'&sourceKind=development-agent&'+f.query);
    for(const [index,label]of ['Accepted Compute A · r7','Accepted Compute B · r8'].entries()){
      const row=document.querySelector(`[data-runtime-task-id="${f.development[index]!.id}"]`)!;expect(row.querySelector('[data-runtime-accepted-profile]')).not.toBeNull();await act(async()=>row.querySelector<HTMLButtonElement>('[data-runtime-accepted-profile]')!.click());await page.settle();expect(openDialog().textContent).toContain(label);await act(async()=>openDialog().dispatchEvent(new Event('cancel',{cancelable:true})));await page.settle();
    }
    expect(document.querySelectorAll('[data-runtime-accepted-profile]')).toHaveLength(2);page.unmount();page=undefined;
  }
});

test('business list retains multiple original compute profiles and detail labels the actual task ID',async()=>{
  const f=runtimeSourceStatisticsFixture({multiProfileBusiness:true}),business=f.details[0]!;
  for(const root of ['/admin/observability','/projects/'+f.projectId+'/observability']){
    page=await renderApp(root+'?tab=tasks&sourceKind=business-task&'+f.query);
    const row=document.querySelector(`[data-runtime-task-id="${business.id}"]`)!;
    await act(async()=>row.querySelector<HTMLButtonElement>('[data-runtime-accepted-profile]')!.click());await page.settle();expect(openDialog().textContent).toContain('Accepted Business A · r7');expect(openDialog().textContent).toContain('Accepted Business B · r8');expect(openDialog().querySelectorAll('tbody tr')).toHaveLength(2);await act(async()=>openDialog().dispatchEvent(new Event('cancel',{cancelable:true})));await page.settle();
    await act(async()=>sourceTaskButton(business.id).click());await page.settle();
    const facts=document.querySelector('[data-runtime-task] dl')!;expect(facts.querySelector('dt')?.textContent).toBe('任务');expect(facts.querySelector('dd')?.textContent).toBe(business.id);
    page.unmount();page=undefined;
  }
});
