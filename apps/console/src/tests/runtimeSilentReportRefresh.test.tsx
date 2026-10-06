// RFC-034: exercise the actual report hook and QueryClient through same-query building, terminal and scope changes.
import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider,focusManager} from '@tanstack/react-query';
import {ProjectIdSchema,runtimeCompleteReportContent,type RuntimeCompleteReport} from '@crewstation/contracts';
import {useRuntimeReport} from '../features/observability/hooks/useRuntimeReport';
import {RuntimeMetrics} from '../features/observability/components/RuntimeMetrics';
import {I18nProvider} from '../shared/lib/I18nProvider';
import {messages} from '../features/observability/i18n/zh-CN';
const originalFetch=globalThis.fetch;
let root:Root|undefined,host:HTMLDivElement|undefined,client:QueryClient|undefined;
afterEach(async()=>{await act(async()=>root?.unmount());client?.clear();host?.remove();globalThis.fetch=originalFetch;focusManager.setFocused(undefined);root=undefined;host=undefined;client=undefined;});
const at='2026-10-04T00:00:00.000Z',filters={from:'2026-10-03T00:00:00.000Z',to:at,timezone:'UTC'},projectId=ProjectIdSchema.parse(Bun.randomUUIDv7());
function snapshot(scope:'system'|'project',gap=false,tokens='12'):RuntimeCompleteReport {
 const reportId=Bun.randomUUIDv7(),pricing={records:'1',pricedRecords:'1',visibility:'visible' as const},bins={input:tokens,cacheRead:'0',cacheWrite:'0',output:'0',total:tokens};
 const metrics=gap?{state:'not-ready' as const,gaps:['native-capture-incomplete'],recordedUsage:{executions:'1',observedExecutions:'1',records:'1',tokens:bins,bucketRecords:{input:'1',cacheRead:'1',cacheWrite:'1',output:'1'}},costCoverage:pricing,recordedCost:{currency:'CNY' as const,amount:'0.000024',records:'1',pricedRecords:'1'}}:{state:'ready' as const,executions:'1',observedExecutions:'1',records:'1',tokens:bins,cost:{currency:'CNY' as const,state:'complete' as const,amount:'0.000024'}};
 const header={reportId,projectionVersion:2 as const,scope,projectId:scope==='project'?projectId:null,filters,asOf:at,snapshotId:'original-'+reportId,generation:'1',sourceRevision:'1',coverage:'complete' as const,buildMs:1};
 const summary={tasks:'1',metrics,durations:{state:'complete' as const,samples:'1',p50Ms:'1',p95Ms:'1',maxMs:'1'},trend:[],sources:[]};
 return gap?{reportId,state:'not-ready',gaps:[{source:'original',reason:'native-capture-incomplete'}],facts:{header:{...header,coverage:'complete-facts'},summary:{...summary,metrics:metrics as Extract<typeof metrics,{state:'not-ready'}>}}}:{reportId,state:'ready',header,summary};
}
const key=(scope:'system'|'project',range=filters)=>['statistics',scope==='project'?projectId:'system',range];
const queryKey=(scope:'system'|'project',range=filters,pinned?:string)=>['runtime-complete','recorded-scope-metrics/3',...key(scope,range),pinned];
async function setup(initial:RuntimeCompleteReport,scope:'system'|'project',options:{cached?:boolean;pinned?:string}={}) {
 client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,staleTime:Infinity}}});
 if(options.cached)client.setQueryData(queryKey(scope,filters,options.pinned),initial);
 const requests:RuntimeCompleteReport[]=[initial],statuses:RuntimeCompleteReport[]=[],counts={requests:0,status:0},reads:string[]=[];
 let currentScope=scope,currentFilters=filters,pinned=options.pinned;
 globalThis.fetch=Object.assign(async(input:Parameters<typeof fetch>[0])=>{counts.status++;reads.push(String(input));const report=statuses.shift();if(!report)throw new Error('Unexpected original report status read');return new Response(JSON.stringify(report),{headers:{'content-type':'application/json'}});},{preconnect:originalFetch.preconnect});
 const request=async()=>{counts.requests++;const report=requests.shift();if(!report)throw new Error('Unexpected duplicate new report request');return report;};
 function Probe(){const query=useRuntimeReport(key(currentScope,currentFilters),request,currentScope==='project'?projectId:undefined,pinned),report=query.data,content=report&&runtimeCompleteReportContent(report);return content?<main data-accepted-report={content.header.reportId}><output>{content.header.reportId}</output><RuntimeMetrics metrics={content.summary.metrics} tasks={content.summary.tasks}/><button>Retained task focus</button><ol>{Array.from({length:201},(_,n)=><li key={n}>Original task {n}</li>)}</ol></main>:<output data-report-state>{report?.state??'pending'}</output>;}
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 const render=async()=>{await act(async()=>root!.render(<QueryClientProvider client={client!}><I18nProvider catalog={{'zh-CN':messages,'en-US':messages}}><Probe/></I18nProvider></QueryClientProvider>));await settle();};
 const settle=async()=>{for(let n=0;n<3;n++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});};
 await render();
 return {requests,statuses,counts,reads,settle,reread:async()=>{await act(async()=>{await client!.refetchQueries({type:'active'});});await settle();},change:async(next:{scope?:'system'|'project';range?:typeof filters;pinned?:string})=>{if(next.scope)currentScope=next.scope;if(next.range)currentFilters=next.range;pinned=next.pinned;await render();}};
}
test.each(['system','project'] as const)('%s preserves the original ready or sealed-facts DOM and polls only the new identity',async scope=>{
 for(const gap of [false,true]){
  const old=snapshot(scope,gap),next=snapshot(scope,gap,'21'),f=await setup(old,scope),main=host!.querySelector('main')!,button=main.querySelector('button')!;
  main.scrollTop=510;button.focus();const before=main.textContent;
  const building:RuntimeCompleteReport={reportId:next.reportId,state:'building',phase:'original-worker'};f.requests.push(building);f.statuses.push(building,next);
  await f.reread();expect(host!.querySelector('main')===main).toBe(true);expect(main.textContent).toBe(before);expect(document.activeElement===button).toBe(true);expect(main.scrollTop).toBe(510);expect(f.counts).toEqual({requests:2,status:0});
  await f.reread();expect(host!.querySelector('main')===main).toBe(true);expect(main.getAttribute('data-accepted-report')).toBe(old.reportId);expect(f.counts).toEqual({requests:2,status:1});
  await f.reread();expect(host!.querySelector('main')===main).toBe(true);expect(main.getAttribute('data-accepted-report')).toBe(next.reportId);expect(main.textContent).toContain('21');expect(f.counts).toEqual({requests:2,status:2});expect(f.reads.every(url=>url.includes(next.reportId))).toBe(true);
  await act(async()=>root!.unmount());client!.clear();host!.remove();root=undefined;client=undefined;host=undefined;
 }
});
test('an already cached accepted snapshot survives building and the actual one-second pending poll completes it',async()=>{
 const old=snapshot('system',true),next=snapshot('system',true,'31'),f=await setup(old,'system',{cached:true}),main=host!.querySelector('main')!;
 const building:RuntimeCompleteReport={reportId:next.reportId,state:'building',phase:'original-worker'};f.requests.length=0;f.requests.push(building);f.statuses.push(next);
 await f.reread();expect(main.getAttribute('data-accepted-report')).toBe(old.reportId);expect(f.counts.requests).toBe(1);
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1150));});await f.settle();
 expect(main.getAttribute('data-accepted-report')).toBe(next.reportId);expect(f.counts).toEqual({requests:1,status:1});
});
test.each(['failed','not-ready'] as const)('a %s terminal revokes retained content and cannot resurrect it on the next building response',async state=>{
 const old=snapshot('system',true),f=await setup(old,'system'),id=Bun.randomUUIDv7(),terminal:RuntimeCompleteReport=state==='failed'?{reportId:id,state,error:'original failure',retryable:true}:{reportId:id,state,gaps:[{source:'original',reason:'facts-unavailable'}]};
 f.requests.push(terminal);await f.reread();expect(host!.querySelector('main')).toBeNull();expect(host!.textContent).toBe(state);
 f.requests.push({reportId:Bun.randomUUIDv7(),state:'building',phase:'original-worker'});await f.reread();expect(host!.querySelector('main')).toBeNull();expect(host!.textContent).toBe('building');
});
test('a revoked original retained page prevents cached facts returning during a later pending refresh',async()=>{
 const old=snapshot('system',true),f=await setup(old,'system');
 await act(async()=>{client!.setQueryData(queryKey('system'),{reportId:old.reportId,state:'not-ready',gaps:[{source:'retained-report',reason:'retained-report-page-unverified'}]});});await f.settle();expect(host!.querySelector('main')).toBeNull();
 f.requests.push({reportId:Bun.randomUUIDv7(),state:'building',phase:'original-worker'});await f.reread();expect(host!.querySelector('main')).toBeNull();expect(host!.textContent).toBe('building');
});
test('a new scope or filter never borrows a previous query snapshot, while retained history stays unchanged',async()=>{
 const old=snapshot('system'),f=await setup(old,'system'),original=JSON.stringify(client!.getQueryData(queryKey('system')));
 f.requests.push({reportId:Bun.randomUUIDv7(),state:'building',phase:'original-worker'});await f.change({scope:'project'});
 expect(host!.querySelector('main')).toBeNull();expect(host!.textContent).toBe('building');expect(JSON.stringify(client!.getQueryData(queryKey('system')))).toBe(original);
 const range={...filters,from:'2026-10-02T00:00:00.000Z'};f.requests.push({reportId:Bun.randomUUIDv7(),state:'building',phase:'original-worker'});await f.change({range});expect(host!.querySelector('main')).toBeNull();expect(host!.textContent).toBe('building');expect(f.counts.requests).toBe(3);
});
test('an initial building report and a changed pinned identity remain actual status rather than borrowed values',async()=>{
 const id=Bun.randomUUIDv7(),building:RuntimeCompleteReport={reportId:id,state:'building',phase:'original-worker'},f=await setup(building,'system');
 expect(host!.querySelector('main')).toBeNull();expect(host!.textContent).toBe('building');
 const pinned=Bun.randomUUIDv7();f.statuses.push({reportId:pinned,state:'building',phase:'original-pinned'});await f.change({pinned});expect(host!.querySelector('main')).toBeNull();expect(host!.textContent).toBe('building');expect(f.counts).toEqual({requests:1,status:1});expect(f.reads[0]).toContain(pinned);
});

test('returning to the foreground refreshes in place and never resets the current task focus',async()=>{
 const old=snapshot('system',true),next=snapshot('system',true,'41'),f=await setup(old,'system'),main=host!.querySelector('main')!,button=main.querySelector('button')!;
 button.focus();main.scrollTop=420;f.requests.push({reportId:next.reportId,state:'building',phase:'original-worker'});f.statuses.push(next);
 focusManager.setFocused(false);await act(async()=>{client!.setQueryData(queryKey('system'),old,{updatedAt:Date.now()-31000});focusManager.setFocused(true);});await f.settle();
 expect(host!.querySelector('main')===main).toBe(true);expect(main.getAttribute('data-accepted-report')).toBe(old.reportId);expect(document.activeElement===button).toBe(true);expect(main.scrollTop).toBe(420);expect(f.counts).toEqual({requests:2,status:0});
 await f.reread();expect(main.getAttribute('data-accepted-report')).toBe(next.reportId);expect(f.counts).toEqual({requests:2,status:1});
});
