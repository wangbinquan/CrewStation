import {useQueryClient} from '@tanstack/react-query';
import {runtimeCompleteReportContent,type RuntimeCompleteReport,type RuntimeReportHeader,type RuntimeReportPageQuery} from '@crewstation/contracts';
import {api} from '../../../shared/api/client';
import {useApiQuery} from '../../../shared/api/useApi';
/** One failed original page revokes its summary; a later valid report can be read normally. */
export function useRuntimeReportPage<T>(key:readonly unknown[],header:RuntimeReportHeader,query:RuntimeReportPageQuery) {
 const client=useQueryClient();
 return useApiQuery(key,async()=>{
  try {
   const page=await api.observability.runtimeReportPage<T>(header.projectId??undefined,header.reportId,query);
   if(page.reportId!==header.reportId||page.snapshotId!==header.snapshotId||page.section!==query.section||page.parent!==(query.parent??null)||page.nextCursor!==null&&(page.nextCursor===query.after||page.items.length===0))throw new Error('Original retained report page identity changed');
   return page;
  } catch(error) {
   client.setQueriesData<RuntimeCompleteReport>({predicate:q=>q.queryKey[0]==='runtime-complete'&&!!q.state.data&&runtimeCompleteReportContent(q.state.data as RuntimeCompleteReport)?.header.reportId===header.reportId},():RuntimeCompleteReport=>({reportId:header.reportId,state:'not-ready',gaps:[{source:'retained-report',reason:'retained-report-page-unverified'}]}));
   throw error;
  }
 });
}
