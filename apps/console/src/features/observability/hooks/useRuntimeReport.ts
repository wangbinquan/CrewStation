import {useRef} from 'react';
import type {RuntimeCompleteReport} from '@crewstation/contracts';
import {api} from '../../../shared/api/client';
import {useApiQuery} from '../../../shared/api/useApi';
/** Poll a building report by identity; request a new complete source revision only after it settles. */
export function useRuntimeReport(key:readonly unknown[],request:()=>Promise<RuntimeCompleteReport>,projectId?:string,pinnedId?:string,enabled=true) {
  const version='task-scope-metrics/2',identity=JSON.stringify([version,...key]),active=useRef<{key:string;report:RuntimeCompleteReport}|undefined>(undefined);
  return useApiQuery<RuntimeCompleteReport>(['runtime-complete',version,...key,pinnedId],async()=>{
    const previous=active.current?.key===identity?active.current.report:undefined;
    const result=pinnedId?await api.observability.runtimeReportStatus(projectId,pinnedId):previous?.state==='building'?await api.observability.runtimeReportStatus(projectId,previous.reportId):await request();
    active.current={key:identity,report:result};return result;
  },{enabled,refetchIntervalMs:data=>data?.state==='building'?1000:30000,refetchOnWindowFocus:true});
}
