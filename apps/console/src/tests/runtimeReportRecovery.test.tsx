// RFC-034: an expired retained report must have a scoped recovery path; original errors remain errors.
import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {renderApp} from './renderApp';
import {runtimeStatisticsFixture} from './runtimeStatisticsFixture';
let page:Awaited<ReturnType<typeof renderApp>>|undefined;
const originalFetch=globalThis.fetch;
afterEach(()=>{page?.unmount();page=undefined;globalThis.fetch=originalFetch;});
const scopes=['system','project','integration'] as const;
function route(scope:typeof scopes[number],projectId:string,taskId?:string){
 const root=scope==='system'?'/admin/observability':scope==='project'?'/projects/'+projectId+'/observability':'/admin/integrations/'+projectId+'/observability';
 return root+(taskId?'/tasks/'+taskId:'');
}
test.each([...scopes])('%s retained report404 recovers the exact overview and original task context',async scope=>{
 for(const detail of [false,true]){
  const f=runtimeStatisticsFixture(),task=f.details[23]!,missing=Bun.randomUUIDv7();
  if(scope==='integration')f.directory.projects[12]!.project.kind='APIProxy';
  const search={tab:'tasks',q:'Task',state:'closed',sourceKind:'business-task',from:'2026-09-28T00:00:00.347Z',to:'2026-09-29T00:00:00.567Z',reportId:missing};
  page=await renderApp(route(scope,f.projectId,detail?task.id:undefined)+'?'+new URLSearchParams(search));
  // The actual local page lost all usage behind an expired report id, although the original ledger still existed.
  expect(page.text()).not.toContain('Report missing');
  const expected=scope==='system'?'/v1/admin/observability/':'/v1/projects/'+f.projectId+'/observability/';
  const oldReads=f.reads.filter(url=>url.includes('/reports/'+missing)&&!url.includes('/pages'));
  expect(oldReads.length).toBeGreaterThan(0);expect(oldReads.every(url=>url.startsWith(expected+'reports/'+missing))).toBe(true);
  // Original report404 automatically reopens only this exact scope. The request
  // count below proves recovery does not duplicate task/window reads.
  expect(page.path()).toBe(route(scope,f.projectId,detail?task.id:undefined));
  expect(page.search()).toMatchObject({tab:'tasks',q:search.q,state:search.state,sourceKind:search.sourceKind,from:search.from,to:search.to});
  expect(page.search().reportId).toBeUndefined();expect(page.text()).not.toContain('Report missing');
  const current=f.reads.filter(url=>url.startsWith(expected+(detail?'tasks/'+task.id:'statistics')));
  expect(current).toHaveLength(1);
  if(detail){
   expect(document.querySelector('[data-runtime-task]')).not.toBeNull();expect(page.text()).toContain('Agent 23');
   expect(page.text()).toContain('80');expect(page.text()).toContain('20');
   if(scope==='system')expect(page.text()).toContain('¥0.25');else expect(page.text()).not.toContain('¥');
   await page.click('返回统计列表');expect(page.path()).toBe(route(scope,f.projectId));
   expect(page.search()).toMatchObject({tab:'tasks',q:search.q,state:search.state,sourceKind:search.sourceKind,from:search.from,to:search.to});
  }else{
   const url=new URL(current[0]!,'http://localhost');
   expect(url.searchParams.get('from')).toBe(search.from);expect(url.searchParams.get('to')).toBe(search.to);
   expect(url.searchParams.get('q')).toBe(search.q);expect(url.searchParams.get('state')).toBe(search.state);expect(url.searchParams.get('sourceKind')).toBe(search.sourceKind);
   expect(document.querySelectorAll('[data-runtime-task-id]')).toHaveLength(24);
  }
  expect(f.directory.writes()).toEqual([]);
  page.unmount();page=undefined;globalThis.fetch=originalFetch;
 }
});
test.each([{status:403,error:'forbidden'},{status:503,error:'unavailable'}])('pinned report$status keeps the original error and does not offer missing-report recovery',async failure=>{
 const f=runtimeStatisticsFixture(),missing=Bun.randomUUIDv7(),delegate=globalThis.fetch;
 globalThis.fetch=Object.assign(async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
  if(String(input).includes('/reports/'+missing))return Response.json({error:failure.error,message:'Original report denied',details:{}},{status:failure.status});
  return delegate(input,init);
 },{preconnect:originalFetch.preconnect});
 page=await renderApp('/admin/observability?'+f.query+'&reportId='+missing);
 expect(page.text()).toContain('Original report denied');expect(page.text()).not.toContain('重新统计');
 expect(f.reads.some(url=>url.includes('/statistics'))).toBe(false);expect(f.directory.writes()).toEqual([]);
});
test('an original missing task without a pinned report keeps404 without rebuilding another task or window',async()=>{
 const f=runtimeStatisticsFixture(),missing=Bun.randomUUIDv7();
 page=await renderApp('/admin/observability/tasks/'+missing+'?'+f.query);
 expect(page.text()).toContain('Task missing');expect(page.text()).not.toContain('重新统计');
 expect(f.reads.filter(url=>url.includes('/tasks/'+missing))).toHaveLength(1);
 expect(f.reads.some(url=>url.includes('/statistics'))).toBe(false);expect(f.directory.writes()).toEqual([]);
});

// A late response for an abandoned scope must never move the current route.
test.each([...scopes])('%s late expired report recovery cannot replace a newer filter scope',async scope=>{
 const f=runtimeStatisticsFixture(),missing=Bun.randomUUIDv7();if(scope==='integration')f.directory.projects[12]!.project.kind='APIProxy';
 const delegate=globalThis.fetch;let release:(()=>void)|undefined,started=false;
 globalThis.fetch=Object.assign(async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
  const url=new URL(String(input),'http://localhost'),response=await delegate(input,init);
  if(url.pathname.endsWith('/statistics')&&url.searchParams.get('q')==='scope-A'){started=true;await new Promise<void>(resolve=>{release=resolve;});}
  return response;
 },{preconnect:originalFetch.preconnect});
 const root=route(scope,f.projectId),search={tab:'tasks',from:'2026-09-28T00:00:00.347Z',to:'2026-09-29T00:00:00.567Z',q:'scope-A',reportId:missing};
 page=await renderApp(root+'?'+new URLSearchParams(search));expect(started).toBe(true);
 await page.navigate(root+'?'+new URLSearchParams({...search,q:'scope-B'}));expect(page.search().q).toBe('scope-B');expect(page.search().reportId).toBeUndefined();
 if(!release)throw new Error('Original recovery was not held');release();await page.settle();
 expect(page.path()).toBe(root);expect(page.search()).toMatchObject({tab:'tasks',from:search.from,to:search.to,q:'scope-B'});expect(page.search().reportId).toBeUndefined();
 expect(f.reads.filter(url=>new URL(url,'http://localhost').pathname.endsWith('/statistics')&&new URL(url,'http://localhost').searchParams.get('q')==='scope-B')).toHaveLength(1);
 expect(f.directory.writes()).toEqual([]);
});
