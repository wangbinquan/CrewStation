import {isApiClientError} from '@crewstation/api-client';
import {useLayoutEffect,useRef} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {runtimeCompleteReportContent,type RuntimeCompleteReport} from '@crewstation/contracts';
import {api} from '../../../shared/api/client';
import {useApiQuery} from '../../../shared/api/useApi';
/** Poll the actual pending report while keeping accepted content in place during a same-query refresh. */
export function useRuntimeReport(key:readonly unknown[],request:()=>Promise<RuntimeCompleteReport>,projectId?:string,pinnedId?:string,enabled=true,format?:'native-pages/1'|'native-pages/2',onPinnedExpired?:()=>void) {
  const version=format==='native-pages/2'?'recorded-scope-metrics/5':format==='native-pages/1'?'recorded-scope-metrics/4':'recorded-scope-metrics/3',queryKey=['runtime-complete',version,...key,pinnedId],identity=JSON.stringify(queryKey),scopeIdentity=JSON.stringify([version,...key]),currentIdentity=useRef<string|null>(identity),expiredCallback=useRef(onPinnedExpired),recovered=useRef<{scope:string;report:RuntimeCompleteReport}|null>(null),client=useQueryClient(),expired=useRef(new Set<string>()),active=useRef<{key:string;report:RuntimeCompleteReport|undefined}|undefined>(undefined);
  useLayoutEffect(()=>{
    currentIdentity.current=identity;expiredCallback.current=onPinnedExpired;
    return ()=>{currentIdentity.current=null;expiredCallback.current=undefined;};
  },[identity,onPinnedExpired]);
  return useApiQuery<RuntimeCompleteReport>(queryKey,async()=>{
    const previous=active.current?.key===identity?active.current.report:undefined,pending={key:identity,report:previous};
    if(currentIdentity.current===identity)active.current=pending;
    // Clearing an expired URL hands the fresh response to the same original
    // scope; it must not issue a second statistics/task request.
    if(!pinnedId&&recovered.current?.scope===scopeIdentity){const result=recovered.current.report;recovered.current=null;pending.report=result;return result;}
    const requested=pinnedId&&!expired.current.has(pinnedId)?pinnedId:previous?.state==='building'?previous.reportId:undefined;
    let result:RuntimeCompleteReport;
    try{result=requested?await api.observability.runtimeReportStatus(projectId,requested):await request();}
    catch(error){if(!requested||!isApiClientError(error)||error.status!==404)throw error;expired.current.add(requested);result=await request();}
    if(pinnedId&&expired.current.has(pinnedId)&&active.current===pending&&currentIdentity.current===identity&&expiredCallback.current){recovered.current={scope:scopeIdentity,report:result};expiredCallback.current();}

    pending.report=result;
    const accepted=client.getQueryData<RuntimeCompleteReport>(queryKey);
    return result.state==='building'&&accepted&&runtimeCompleteReportContent(accepted)?accepted:result;
  },{enabled,refetchIntervalMs:data=>active.current?.key===identity&&active.current.report?.state==='building'||data?.state==='building'?1000:key[0]==='task'?30000:undefined,refetchOnWindowFocus:pinnedId!==undefined||key[0]==='task'});
}
