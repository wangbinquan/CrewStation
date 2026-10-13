import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {act,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {I18nProvider} from '../shared/lib/I18nProvider';
import {messages} from '../features/observability/i18n/zh-CN';
import {RuntimeStorage} from '../features/observability/components/runtime/RuntimeStorage';
import {useRuntimeReport} from '../features/observability/hooks/useRuntimeReport';
import type {RuntimeCompleteReport} from '@crewstation/contracts';
const originalFetch=globalThis.fetch;let root:Root|undefined,host:HTMLDivElement|undefined,client:QueryClient|undefined;
afterEach(async()=>{await act(async()=>root?.unmount());client?.clear();host?.remove();globalThis.fetch=originalFetch;});
async function render(element:ReactNode){host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});await act(async()=>root!.render(<QueryClientProvider client={client!}><I18nProvider catalog={{'zh-CN':messages,'en-US':messages}}>{element}</I18nProvider></QueryClientProvider>));await act(async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setTimeout(resolve,0));});}
const status={sampledAt:'2026-10-13T00:00:00Z',databaseBytes:'1048576',factsBytes:'524288',derivedBytes:'262144',indexBytes:'262144',reusableBytes:null,freeBytes:null,growthBytesPerDay:null,daysRemaining:null,pending:'12001',oldestPendingAt:'2026-10-12T00:00:00Z',activeReports:'201',retiringReports:'2',reclaimed:'10001',lastSuccess:'2026-10-13T00:00:00Z',lastError:'disk full',retentionDays:7};
test('system storage shows exact unbounded backlog and unknown remote volume with standard layout',async()=>{globalThis.fetch=(async raw=>{expect(new URL(String(raw),'http://localhost').pathname).toBe('/v1/admin/observability/storage');return Response.json(status);}) as typeof fetch;await render(<RuntimeStorage/>);expect(host!.textContent).toContain('12001');expect(host!.textContent).toContain('201 / 2');expect(host!.textContent).toContain('未采集');expect(host!.textContent).toContain('disk full');expect(host!.querySelector('dl')).not.toBeNull();expect(host!.textContent).not.toContain('USD');});
test('an expired pinned link requests its original scope once and renders a new identity',async()=>{let requests=0,statusReads=0;const next={reportId:Bun.randomUUIDv7(),state:'not-ready',gaps:[{source:'fixture',reason:'known-source-gap'}]} as RuntimeCompleteReport,expired=Bun.randomUUIDv7();globalThis.fetch=(async raw=>{expect(String(raw)).toContain('/reports/'+expired);statusReads++;return Response.json({error:'not_found',message:'expired',details:{}},{status:404});}) as typeof fetch;function Probe(){const q=useRuntimeReport(['statistics','system','original-period'],async()=>{requests++;return next;},undefined,expired);return <p>{q.data?.reportId}</p>;}await render(<Probe/>);expect(host!.textContent).toContain(next.reportId);expect(statusReads).toBe(1);expect(requests).toBe(1);});
