// RFC-034: frozen maintenance state and late preview isolation through the actual routed UI.
import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {act} from 'react';
import {RuntimeMaintenanceSchema,type RuntimeMaintenanceRequest} from '@crewstation/contracts';
import {renderApp} from './renderApp';
import {runtimeStatisticsFixture} from './runtimeStatisticsFixture';
import {openDialog} from './confirmDialogDriver';
let page:Awaited<ReturnType<typeof renderApp>>|undefined;const originalFetch=globalThis.fetch;
afterEach(()=>{page?.unmount();page=undefined;globalThis.fetch=originalFetch;});
function fixture(){const f=runtimeStatisticsFixture(),fallback=globalThis.fetch,id=Bun.randomUUIDv7(),state:{operation?:ReturnType<typeof RuntimeMaintenanceSchema.parse>;release?:()=>void;hold:boolean}={hold:false},requests:RuntimeMaintenanceRequest[]=[];
 globalThis.fetch=(async(raw,init)=>{const url=new URL(String(raw),'http://localhost');
  if(url.pathname.endsWith('/maintenance/preview')){const request=JSON.parse(String(init?.body)) as RuntimeMaintenanceRequest;requests.push(request);if(state.hold)await new Promise<void>(resolve=>{state.release=resolve;});state.operation=RuntimeMaintenanceSchema.parse({id,request,state:'preview',sourceRevision:'1',scopeDigest:'a'.repeat(64),createdAt:f.to,confirmedAt:null,tasks:'24',records:'24',processedTasks:'0',processedRecords:'0',knownOriginalCny:'6',knownProposedCny:'6',knownDeltaCny:'0',unpricedRecords:'0',gaps:[]});return Response.json(state.operation);}
  if(url.pathname.endsWith('/maintenance/'+id+'/confirm')){expect(JSON.parse(String(init?.body))).toEqual({expectedDigest:'a'.repeat(64),confirmation:'APPLY'});state.operation=RuntimeMaintenanceSchema.parse({...state.operation,state:'running',confirmedAt:f.to});return Response.json(state.operation);}
  if(url.pathname.endsWith('/maintenance/'+id))return Response.json(state.operation);
  return fallback(raw,init);
 }) as typeof fetch;return {...f,state,requests};
}
test('confirmation replaces a cached preview immediately and keeps the frozen preview range during live updates',async()=>{
 const f=fixture();page=await renderApp('/admin/observability?tab=usage&'+f.query);await page.click('预览历史维护');await page.click('生成预览');
 expect(openDialog().textContent).toContain('预览就绪');expect(f.requests).toHaveLength(1);expect(f.requests[0]!.filters).toMatchObject({from:f.from,to:f.to});
 await page.click('确认执行这份预览');expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
 await page.click('确认执行这份预览');expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);expect(openDialog().textContent).toContain('后台处理中');
 expect([...openDialog().querySelectorAll('button')].some(button=>button.textContent==='确认执行这份预览')).toBe(false);
 await act(async()=>openDialog().dispatchEvent(new Event('cancel',{cancelable:true})));await page.settle();expect(document.activeElement?.textContent).toBe('预览历史维护');
});
test('a late preview cannot restore an operation after the user changes its mode',async()=>{
 const f=fixture();f.state.hold=true;page=await renderApp('/admin/observability?tab=usage&'+f.query);await page.click('预览历史维护');
 const submit=[...openDialog().querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='生成预览')!;await act(async()=>submit.click());await page.settle();
 expect(f.state.release).toBeDefined();const choice=openDialog().querySelectorAll<HTMLInputElement>('input[type=radio]')[0]!;await act(async()=>choice.click());await page.settle();
 await act(async()=>f.state.release!());await page.settle();expect(openDialog().textContent).not.toContain('预览就绪');expect([...openDialog().querySelectorAll('button')].some(button=>button.textContent==='确认执行这份预览')).toBe(false);
});
