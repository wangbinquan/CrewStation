// The actual report hook must ignore an old-format cached report without mutating its pinned history.
import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {RuntimeCompleteReport} from '@crewstation/contracts';
import {useRuntimeReport} from '../features/observability/hooks/useRuntimeReport';
let root:Root|undefined,element:HTMLDivElement|undefined,client:QueryClient|undefined;const originalFetch=globalThis.fetch;
afterEach(async()=>{await act(async()=>root?.unmount());client?.clear();element?.remove();root=undefined;client=undefined;element=undefined;globalThis.fetch=originalFetch;});
test.each(['system','project'] as const)('%s requests the current Task-metric format instead of reusing an immutable legacy query',async scope=>{
 const key=['statistics',scope,{from:'2026-10-03T00:00:00.000Z',to:'2026-10-04T00:00:00.000Z',timezone:'UTC'}],oldKey=['runtime-complete',...key,undefined],legacy:RuntimeCompleteReport={reportId:'old-immutable-facts-report',state:'not-ready',gaps:[{source:'old-format',reason:'whole-gap-masked-tasks'}]},current:RuntimeCompleteReport={reportId:'current-task-metric-report',state:'not-ready',gaps:[{source:'original-cohort',reason:'native-capture-incomplete'}]};
 client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,staleTime:Infinity}}});client.setQueryData(oldKey,legacy);const versionTwoKey=['runtime-complete','task-scope-metrics/2',...key,undefined];client.setQueryData(versionTwoKey,legacy);const original=JSON.stringify(client.getQueryData(oldKey));let requests=0,statusReads=0;
 globalThis.fetch=Object.assign(async()=>{statusReads++;throw new Error('Old retained report status must not be read');},{preconnect:originalFetch.preconnect});
 function Probe(){const query=useRuntimeReport(key,async()=>{requests++;return current;},scope==='project'?'original-project':undefined);return <output>{query.data?.reportId??'waiting'}</output>;}
 element=document.createElement('div');document.body.append(element);root=createRoot(element);await act(async()=>root!.render(<QueryClientProvider client={client!}><Probe/></QueryClientProvider>));
 for(let n=0;n<20&&element.textContent!==current.reportId;n++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
 expect(element.textContent).toBe(current.reportId);expect(requests).toBe(1);expect(statusReads).toBe(0);expect(JSON.stringify(client.getQueryData(oldKey))).toBe(original);expect(JSON.stringify(client.getQueryData(versionTwoKey))).toBe(original);expect(client.getQueryCache().getAll().some(query=>query.queryKey.includes('recorded-scope-metrics/3'))).toBe(true);
});
