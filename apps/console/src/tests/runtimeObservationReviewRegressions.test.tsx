// RFC-034: actual components retain CLI identity, immutable maintenance retries and unknown phase clocks.
import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {act} from 'react';
import type {ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {RuntimeMaintenanceSchema,RuntimeReportHeaderSchema,RuntimePhaseSchema,type RuntimeMaintenanceRequest} from '@crewstation/contracts';
import {I18nProvider} from '../shared/lib/I18nProvider';
import {messages} from '../features/observability/i18n/zh-CN';
import {RuntimeSourceFilter} from '../features/observability/components/RuntimeSources';
import {RuntimeMaintenance} from '../features/observability/components/runtime/RuntimeMaintenance';
import {RuntimePhases} from '../features/observability/components/runtime/RuntimePhases';
import type {RuntimeSearch} from '../features/observability/model/runtimeSearch';
import {openDialog} from './confirmDialogDriver';
const originalFetch=globalThis.fetch;
let root:Root|undefined,host:HTMLDivElement|undefined,client:QueryClient|undefined;
afterEach(async()=>{await act(async()=>root?.unmount());client?.clear();host?.remove();root=undefined;host=undefined;client=undefined;globalThis.fetch=originalFetch;});
const settle=async()=>act(async()=>{for(let n=0;n<5;n++)await new Promise(resolve=>setTimeout(resolve,0));});
async function render(content:ReactNode){if(!root){host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,staleTime:Infinity}}});}await act(async()=>root!.render(<QueryClientProvider client={client!}><I18nProvider catalog={{'zh-CN':messages,'en-US':messages}}>{content}</I18nProvider></QueryClientProvider>));await settle();}
async function click(label:string){const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(value=>value.textContent===label);expect(button).toBeDefined();await act(async()=>button!.click());await settle();}
const window={from:'2026-10-01T00:00:00.000Z',to:'2026-10-12T00:00:00.000Z',timezone:'UTC'};
test('the real purpose controls distinguish CLI, development Agent and business task identities',async()=>{
 let selected:RuntimeSearch={};const change=(next:RuntimeSearch)=>{selected=next;};await render(<RuntimeSourceFilter search={selected} change={change}/>);
 for(const [label,kind]of [['交互 CLI','development-cli'],['开发 Agent','development-agent'],['业务任务','business-task']] as const){expect([...host!.querySelectorAll('button')].filter(button=>button.textContent===label)).toHaveLength(1);await click(label);expect(selected.sourceKind).toBe(kind);await render(<RuntimeSourceFilter search={selected} change={change}/>);expect(host!.querySelector('[aria-pressed="true"]')?.textContent).toBe(label);}
});
test('a retry after the rolling window advances sends the exact frozen request with the same key',async()=>{
 const requests:RuntimeMaintenanceRequest[]=[],id=Bun.randomUUIDv7();let current:ReturnType<typeof RuntimeMaintenanceSchema.parse>|undefined;
 globalThis.fetch=(async(raw,init)=>{const url=new URL(String(raw),'http://localhost');if(url.pathname.endsWith('/maintenance/preview')){const request=JSON.parse(String(init?.body)) as RuntimeMaintenanceRequest;requests.push(request);if(requests.length===2)expect(request).toEqual(requests[0]!);current=RuntimeMaintenanceSchema.parse({id,request,state:'preview',sourceRevision:'1',scopeDigest:'a'.repeat(64),createdAt:window.to,confirmedAt:null,tasks:'1',records:'1',processedTasks:'0',processedRecords:'0',knownOriginalCny:'1',knownProposedCny:'1',knownDeltaCny:'0',unpricedRecords:'0',gaps:[]});return Response.json(current);}if(url.pathname.endsWith('/maintenance/'+id))return Response.json(current);throw new Error('Unexpected '+url.pathname);}) as typeof fetch;
 await render(<RuntimeMaintenance scopeKey="same-route" window={window}/>);await click('预览历史维护');await click('生成预览');expect(requests).toHaveLength(1);
 const advanced={...window,from:'2026-10-01T00:01:00.000Z',to:'2026-10-12T00:01:00.000Z'};await render(<RuntimeMaintenance scopeKey="same-route" window={advanced}/>);await click('生成预览');expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect(requests[1]!.filters).toEqual(window);expect(openDialog().textContent).toContain('预览就绪');
 const mode=openDialog().querySelectorAll<HTMLInputElement>('input[type=radio]')[0]!;await act(async()=>mode.click());await settle();await click('生成预览');expect(requests).toHaveLength(3);expect(requests[2]!.requestKey).not.toBe(requests[1]!.requestKey);expect(requests[2]!.filters).toEqual(advanced);expect(requests[2]!.mode).toBe('backfill');
});
test('a phase with no real clock preserves an unknown axis and an accessible original detail',async()=>{
 const reportId=Bun.randomUUIDv7(),taskId=Bun.randomUUIDv7(),header=RuntimeReportHeaderSchema.parse({reportId,projectionVersion:2,scope:'system',projectId:null,filters:window,asOf:window.to,snapshotId:'original-unknown-clock',generation:'1',sourceRevision:'1',coverage:'complete',buildMs:1}),phase=RuntimePhaseSchema.parse({key:'unknown-phase',taskId,runtimeTaskId:Bun.randomUUIDv7(),agentId:'original-agent',agentName:'Original Agent',turnId:null,kind:'unknown',source:'native-activity',quality:'unknown',startedAt:null,endedAt:null,durationMs:null,open:false,reason:'clock-unavailable'});
 globalThis.fetch=(async raw=>{const url=new URL(String(raw),'http://localhost');expect(url.pathname.endsWith('/reports/'+reportId+'/pages')).toBe(true);expect(url.searchParams.get('section')).toBe('phases');return Response.json({reportId,snapshotId:header.snapshotId,section:'phases',parent:taskId,total:'1',items:[phase],nextCursor:null});}) as typeof fetch;
 await render(<RuntimePhases header={header} taskId={taskId} totals={{range:null,activeMs:'0',activeUnionMs:'0',waitingMs:'0',waitingUnionMs:'0',unknownSegments:'1',residenceMs:null,queueMs:'0',initializationMs:'0',cleanupMs:'0',retentionMs:'0'}}/>);
 const region=host!.querySelector('[role="region"]')!,epoch=new Intl.DateTimeFormat(undefined,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(0));expect(region.textContent).toContain('时间证据缺失');expect(region.textContent).not.toContain(epoch);expect(region.querySelector('[data-phase]')).toBeNull();const trigger=region.querySelector<HTMLButtonElement>('button')!;expect(trigger.textContent).toContain('时间未确认');await act(async()=>trigger.click());await settle();expect(openDialog().textContent).toContain('Original Agent');expect(openDialog().textContent).toContain('clock-unavailable');const dates=[...openDialog().querySelectorAll('dt')].filter(dt=>['开始时间','结束时间'].includes(dt.textContent??'')).map(dt=>dt.nextElementSibling?.textContent);expect(dates).toEqual(['—','—']);await act(async()=>openDialog().dispatchEvent(new Event('cancel',{cancelable:true})));await settle();expect(document.activeElement).toBe(trigger);
});
