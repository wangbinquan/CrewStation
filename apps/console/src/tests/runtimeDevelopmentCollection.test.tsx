// Formal source labels and immutable query format only; fixtures do not execute a model or create numeric readiness.
import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {act,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {RuntimeCompleteSummarySchema,RuntimeCompleteReportSchema,type RuntimeCompleteReport,type RuntimeCompleteSummary} from '@crewstation/contracts';
import {I18nProvider} from '../shared/lib/I18nProvider';
import {messages as zh} from '../features/observability/i18n/zh-CN';
import {messages as en} from '../features/observability/i18n/en-US';
import {RuntimeSources} from '../features/observability/components/RuntimeSources';
import {useRuntimeReport} from '../features/observability/hooks/useRuntimeReport';
import type {RuntimeSearch} from '../features/observability/model/runtimeSearch';
const originalFetch=globalThis.fetch;let root:Root|undefined,host:HTMLDivElement|undefined,client:QueryClient|undefined;
afterEach(async()=>{await act(async()=>root?.unmount());client?.clear();host?.remove();globalThis.fetch=originalFetch;root=undefined;host=undefined;client=undefined;});
const filters={from:'2026-10-03T00:00:00.000Z',to:'2026-10-04T00:00:00.000Z',timezone:'UTC'};
async function setup(node:ReactNode,queryClient=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,staleTime:Infinity}}}),locale:'zh-CN'|'en-US'='zh-CN'){
 client=queryClient;host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<QueryClientProvider client={client!}><I18nProvider initialLocale={locale} catalog={{'zh-CN':zh,'en-US':en}}>{node}</I18nProvider></QueryClientProvider>));for(let n=0;n<3;n++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
}
function retainedReport(selected=false):RuntimeCompleteReport{
 const reportId=Bun.randomUUIDv7();return RuntimeCompleteReportSchema.parse({reportId,state:'ready',header:{reportId,projectionVersion:2,scope:'system',projectId:null,filters,asOf:filters.to,snapshotId:'original-retained',generation:'1',sourceRevision:'1',coverage:'complete',buildMs:1},summary:{tasks:'0',metrics:{state:'not-applicable'},durations:{state:'complete',samples:'0',p50Ms:null,p95Ms:null,maxMs:null},trend:[],sources:[{kind:'business-task',tasks:'0',metrics:{state:'not-applicable'},collectionState:'available'},{kind:'development-agent',tasks:'0',metrics:{state:'not-applicable'},collectionState:selected?'validation-selected':'production-disabled'}]}});
}
for(const locale of ['zh-CN','en-US'] as const)test('explicit validation source keeps recorded four bins, partial CNY, scope and an honest footer: '+locale,async()=>{
 const catalog=locale==='zh-CN'?zh:en,metric:RuntimeCompleteSummary['metrics']={state:'not-ready',gaps:['native-capture-incomplete'],recordedUsage:{executions:'1',observedExecutions:'1',records:'1',tokens:{input:'11',cacheRead:'13',cacheWrite:null,output:'17',total:'41'},bucketRecords:{input:'1',cacheRead:'1',cacheWrite:'0',output:'1'}},costCoverage:{records:'1',pricedRecords:'0',partiallyPricedRecords:'1',visibility:'visible'},recordedCost:{currency:'CNY',amount:'0.0001645',records:'1',pricedRecords:'0',partiallyPricedRecords:'1'}};
 const data=RuntimeCompleteSummarySchema.parse({tasks:'1',metrics:metric,durations:{state:'not-ready',gaps:['timing-missing']},trend:[],sources:[{kind:'business-task',tasks:'0',metrics:{state:'not-applicable'},collectionState:'available'},{kind:'development-agent',tasks:'1',metrics:metric,collectionState:'validation-selected'}]}),search:RuntimeSearch={tab:'overview',from:filters.from,to:filters.to,agent:'previous-agent',profile:'previous-profile',quality:'native-capture-incomplete'},changes:RuntimeSearch[]=[];
 await setup(<RuntimeSources data={data} search={search} change={next=>changes.push(next)}/>,undefined,locale);const row=host!.querySelector('[data-runtime-source="development-agent"]')!;
 expect([...row.querySelectorAll('td')].slice(1,7).map(cell=>cell.textContent)).toEqual(['1','11','13','—','17','41']);expect(row.textContent).toContain('¥0.0001645');expect(row.textContent).toContain(catalog['runtime.source.validation-selected']);expect(host!.textContent).toContain(catalog['runtime.source.validation-hint']);expect(host!.textContent).not.toContain(catalog['runtime.source.production-disabled']);expect(host!.textContent).not.toContain('$');
 await act(async()=>row.querySelector<HTMLButtonElement>('button')!.click());expect(changes).toEqual([{...search,sourceKind:'development-agent',tab:'tasks',agent:undefined,profile:undefined}]);expect(data.sources[1]!.metrics).toEqual(metric);
});
test('native-pages/2 uses a fresh metrics v5 query while retained metrics v3 and v4 stay byte-identical',async()=>{
 const key=['statistics','system',filters],old=retainedReport(),v3=['runtime-complete','recorded-scope-metrics/3',...key,undefined],v4=['runtime-complete','recorded-scope-metrics/4',...key,undefined],v5=['runtime-complete','recorded-scope-metrics/5',...key,undefined],current=retainedReport(true),qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,staleTime:Infinity}}});qc.setQueryData(v3,old);qc.setQueryData(v4,old);const bytes=JSON.stringify(old);let requests=0;
 function Probe(){const query=useRuntimeReport(key,async()=>{requests++;return current;},undefined,undefined,true,'native-pages/2');return <output>{query.data?.reportId??'waiting'}</output>;}
 await setup(<Probe/>,qc);expect(requests).toBe(1);expect(host!.textContent).toBe(current.reportId);expect(qc.getQueryData<RuntimeCompleteReport>(v5)).toEqual(current);expect(JSON.stringify(qc.getQueryData<RuntimeCompleteReport>(v3))).toBe(bytes);expect(JSON.stringify(qc.getQueryData<RuntimeCompleteReport>(v4))).toBe(bytes);
});
test('pinned original legacy report remains readable in the new query format and never requests a replacement',async()=>{
 const key=['statistics','system',filters],old=retainedReport(),reads:string[]=[];let replacements=0;globalThis.fetch=Object.assign(async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{expect(init?.method??'GET').toBe('GET');reads.push(String(input));return Response.json(old);},{preconnect:originalFetch.preconnect});
 function Probe(){const query=useRuntimeReport(key,async()=>{replacements++;throw Error('pinned original report must not be replaced');},undefined,old.reportId,true,'native-pages/2');return <output>{query.data?.reportId??'waiting'}</output>;}
 await setup(<Probe/>);expect(replacements).toBe(0);expect(reads).toHaveLength(1);expect(reads[0]).toContain('/reports/'+old.reportId);expect(host!.textContent).toBe(old.reportId);expect(client!.getQueryData<RuntimeCompleteReport>(['runtime-complete','recorded-scope-metrics/5',...key,old.reportId])).toEqual(old);
});
test('a same-query refresh retains the original accepted content while building and adopts the actual later report without altering legacy caches',async()=>{
 const key=['statistics','system',filters],queryKey=['runtime-complete','recorded-scope-metrics/5',...key,undefined],oldKey=['runtime-complete','recorded-scope-metrics/4',...key,undefined],old=retainedReport(),next=retainedReport(true),pending:RuntimeCompleteReport={reportId:next.reportId,state:'building',phase:'collecting'},qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,staleTime:Infinity}}});qc.setQueryData(oldKey,old);let requests=0,reads=0;
 globalThis.fetch=Object.assign(async(input:Parameters<typeof fetch>[0])=>{reads++;expect(String(input)).toContain('/reports/'+next.reportId);return Response.json(next);},{preconnect:originalFetch.preconnect});
 function Probe(){const query=useRuntimeReport(key,async()=>++requests===1?old:pending,undefined,undefined,true,'native-pages/2');return <output>{query.data?.reportId??'waiting'}</output>;}
 await setup(<Probe/>,qc);expect(host!.textContent).toBe(old.reportId);await act(async()=>qc.refetchQueries({queryKey,exact:true}));expect(requests).toBe(2);expect(host!.textContent).toBe(old.reportId);expect(qc.getQueryData<RuntimeCompleteReport>(queryKey)).toEqual(old);
 await act(async()=>{await qc.refetchQueries({queryKey,exact:true});await new Promise(resolve=>setTimeout(resolve,0));});expect(reads).toBe(1);expect(requests).toBe(2);expect(qc.getQueryData<RuntimeCompleteReport>(queryKey)).toEqual(next);expect(qc.getQueryData<RuntimeCompleteReport>(oldKey)).toEqual(old);expect(host!.textContent).toBe(next.reportId);
});
