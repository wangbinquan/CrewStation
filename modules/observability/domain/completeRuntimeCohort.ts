import type {RuntimeFactQuery,RuntimeTaskHeaderFact,RuntimeSourceKind} from '@crewstation/contracts';
import {emptyCompleteRuntimeFold,type CompleteRuntimeFold} from './completeRuntimeMetrics';
export const completeRuntimeSourceKind=(task:RuntimeTaskHeaderFact):RuntimeSourceKind=>task.source?.kind??'business-task';
export function matchesCompleteRuntimeCohort(task:RuntimeTaskHeaderFact,gaps:readonly string[],query:RuntimeFactQuery) {
  return (!query.sourceKind||completeRuntimeSourceKind(task)===query.sourceKind)&&(!query.state||task.state===query.state)&&(!query.quality||gaps.includes(query.quality))&&(!query.q||`${task.name} ${task.id} ${task.projectName??''} ${task.projectId}`.toLowerCase().includes(query.q.toLowerCase()));
}
export interface CompleteTrendFold {readonly from:string;readonly to:string;count:string;readonly fold:CompleteRuntimeFold}
/** Bucket count controls chart resolution, never the task or usage population. */
export function completeTrendFolds(query:RuntimeFactQuery,visible:boolean):CompleteTrendFold[] {
  const from=Date.parse(query.from),to=Date.parse(query.to),count=Math.min(24,Math.max(1,Math.ceil((to-from)/3600000))),step=(to-from)/count;
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>=to) throw new Error('Original cohort interval is invalid');
  return Array.from({length:count},(_,n)=>({from:new Date(Math.floor(from+step*n)).toISOString(),to:new Date(n===count-1?to:Math.floor(from+step*(n+1))).toISOString(),count:'0',fold:emptyCompleteRuntimeFold(visible)}));
}
