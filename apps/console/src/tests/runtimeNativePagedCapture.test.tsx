// Formal components and cache format: metadata never creates a numeric ledger or complete zero.
import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {RuntimeFactReportHeaderSchema,RuntimeNativePagedCaptureSchema,type RuntimeCompleteReport} from '@crewstation/contracts';
import {I18nProvider} from '../shared/lib/I18nProvider';
import {messages} from '../features/observability/i18n/zh-CN';
import {RuntimeNativeCaptures} from '../features/observability/components/RuntimeNativeCapture';
import {useRuntimeReport} from '../features/observability/hooks/useRuntimeReport';
const originalFetch=globalThis.fetch;let root:Root|undefined,host:HTMLDivElement|undefined,client:QueryClient|undefined;
afterEach(async()=>{await act(async()=>root?.unmount());client?.clear();host?.remove();globalThis.fetch=originalFetch;root=undefined;host=undefined;client=undefined;});
const filters={from:'2026-10-03T00:00:00.000Z',to:'2026-10-04T00:00:00.000Z',timezone:'UTC'};
async function setup(node:React.ReactNode,queryClient=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,staleTime:Infinity}}})) {
 client=queryClient;host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<QueryClientProvider client={client!}><I18nProvider catalog={{'zh-CN':{...messages,'ui.dialog.close':'关闭'},'en-US':messages}}>{node}</I18nProvider></QueryClientProvider>));
 for(let n=0;n<3;n++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
}
test('facts display original source and worker states with exact large population text and preparation time, and never request restricted legacy numeric captures',async()=>{
 const id=()=>Bun.randomUUIDv7(),header=RuntimeFactReportHeaderSchema.parse({reportId:id(),projectionVersion:2,scope:'system',projectId:null,filters,asOf:filters.to,snapshotId:'original-paged-ui-snapshot',generation:'1',sourceRevision:'1',coverage:'complete-facts',buildMs:1});
 const item=RuntimeNativePagedCaptureSchema.parse({id:'a'.repeat(64),sourceVersion:2,identity:{sourceKind:'development-agent',projectId:id(),taskId:id(),agentId:id(),executionId:id(),executionGeneration:1},sourceId:'original-native-source',
  pass:{passId:'actual-pass',turn:'actual-turn',nativeSource:'opencode:original',sourceGeneration:'original-generation',rootSessionId:'original-root',lineageKey:'original-lineage',epoch:'original-epoch',phase:'final'},turnIndex:0,preparedAt:filters.from,
  sourceState:'source-eof',pages:'2',counts:{sessions:'9007199254740993',parts:'9007199254740995',steps:'9007199254740994'},scanPosition:'9007199254740995',sourceWatermark:'11',pathsComplete:true,workState:'pending',visitedSteps:'65',heldSteps:'0',cursor:{ordinal:'1',index:0},numericEof:false,valuationEof:false,baselineState:'unknown',issues:['native-root-birth-unproved'],sourceDigest:'b'.repeat(64),previousPopulation:{visited:'9007199254740994',held:'9007199254740993',issues:['native-root-birth-unproved']}});
 const reads:string[]=[];globalThis.fetch=Object.assign(async(input:Parameters<typeof fetch>[0])=>{const url=new URL(String(input),'http://localhost');reads.push(url.searchParams.get('section')??'none');return Response.json({reportId:header.reportId,snapshotId:header.snapshotId,section:'native-pages',parent:'original-attempt',total:'1',items:[item],nextCursor:null});},{preconnect:originalFetch.preconnect});
 await setup(<RuntimeNativeCaptures header={header} attemptId="original-attempt" attemptName="原始验收 Agent"/>);
 expect(reads).toEqual(['native-pages']);expect(host!.textContent).toContain('原始验收 Agent · 第 1 轮 · 执行后');expect(host!.textContent).toContain('65 / 9,007,199,254,740,994');expect(host!.textContent).toContain('已收齐');expect(host!.textContent).toContain('待处理或核对');expect(host!.textContent).toContain('尚未证明');expect(host!.textContent).not.toContain('¥');expect(host!.textContent).not.toContain('最近观测');expect(host!.textContent).toContain('上次处理有 9,007,199,254,740,993 个步骤待核对');
 const opener=[...host!.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.includes('原始验收 Agent'))!;opener.focus();await act(async()=>opener.click());
 const dialog=document.querySelector<HTMLDialogElement>('dialog[open]')!;expect(dialog).not.toBeNull();expect(dialog.textContent).toContain('准备时间');expect(dialog.textContent).toContain('9,007,199,254,740,993');expect(dialog.textContent).toContain('original-root');expect(dialog.textContent).toContain(item.sourceDigest);expect(dialog.textContent).toContain('上次已处理步骤');expect(dialog.textContent).toContain('9,007,199,254,740,994');expect(dialog.textContent).toContain('尚未证明这是新建根会话，保留已知消耗');
 await act(async()=>dialog.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());expect(document.querySelector('dialog[open]')).toBeNull();expect(document.activeElement).toBe(opener);
});
test('formal native-pages format requests a fresh report and preserves the immutable prior recorded-metrics cache',async()=>{
 const key=['statistics','system',filters],oldKey=['runtime-complete','recorded-scope-metrics/3',...key,undefined],old:RuntimeCompleteReport={reportId:'original-old-recorded-metrics',state:'not-ready',gaps:[{source:'old-format',reason:'native-capture-unobserved'}]},current:RuntimeCompleteReport={reportId:'new-original-paged-source',state:'not-ready',gaps:[{source:'actual-pages',reason:'native-capture-incomplete'}]};
 const qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,staleTime:Infinity}}});qc.setQueryData(oldKey,old);let requests=0;
 function Probe(){const query=useRuntimeReport(key,async()=>{requests++;return current;},undefined,undefined,true,'native-pages/1');return <output>{query.data?.reportId??'waiting'}</output>;}
 await setup(<Probe/>,qc);expect(requests).toBe(1);expect(host!.textContent).toBe(current.reportId);expect(qc.getQueryData<RuntimeCompleteReport>(oldKey)).toEqual(old);expect(qc.getQueryCache().getAll().some(query=>query.queryKey.includes('recorded-scope-metrics/4'))).toBe(true);
});
