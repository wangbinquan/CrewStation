import {useRef} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {runtimeCompleteReportContent,type RuntimeCompleteReport} from '@crewstation/contracts';
import {api} from '../../../shared/api/client';
import {useApiQuery} from '../../../shared/api/useApi';
/** Poll the actual pending report while keeping accepted content in place during a same-query refresh. */
export function useRuntimeReport(key:readonly unknown[],request:()=>Promise<RuntimeCompleteReport>,projectId?:string,pinnedId?:string,enabled=true,format?:'native-pages/1') {
  const version=format==='native-pages/1'?'recorded-scope-metrics/4':'recorded-scope-metrics/3',queryKey=['runtime-complete',version,...key,pinnedId],identity=JSON.stringify(queryKey),client=useQueryClient(),active=useRef<{key:string;report:RuntimeCompleteReport|undefined}|undefined>(undefined);
  return useApiQuery<RuntimeCompleteReport>(queryKey,async()=>{
    const previous=active.current?.key===identity?active.current.report:undefined,pending={key:identity,report:previous};
    active.current=pending;
    const result=pinnedId?await api.observability.runtimeReportStatus(projectId,pinnedId):previous?.state==='building'?await api.observability.runtimeReportStatus(projectId,previous.reportId):await request();
    pending.report=result;
    const accepted=client.getQueryData<RuntimeCompleteReport>(queryKey);
    return result.state==='building'&&accepted&&runtimeCompleteReportContent(accepted)?accepted:result;
  },{enabled,refetchIntervalMs:data=>active.current?.key===identity&&active.current.report?.state==='building'||data?.state==='building'?1000:30000,refetchOnWindowFocus:true});
}
