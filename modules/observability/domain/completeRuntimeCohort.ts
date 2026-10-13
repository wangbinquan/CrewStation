import type {RuntimeFactQuery,RuntimeTaskHeaderFact,RuntimeSourceKind} from '@crewstation/contracts';
import {emptyCompleteRuntimeFold,type CompleteRuntimeFold} from './completeRuntimeMetrics';
export const completeRuntimeSourceKind=(task:RuntimeTaskHeaderFact):RuntimeSourceKind=>task.source?.kind??'business-task';
export function matchesCompleteRuntimeCohort(task:RuntimeTaskHeaderFact,gaps:readonly string[],query:RuntimeFactQuery) {
  return (!query.sourceKind||completeRuntimeSourceKind(task)===query.sourceKind)&&(!query.state||task.state===query.state)&&(!query.quality||gaps.includes(query.quality))&&(!query.q||`${task.name} ${task.id} ${task.projectName??''} ${task.projectId}`.toLowerCase().includes(query.q.toLowerCase()));
}
export interface CompleteTrendFold {readonly from:string;readonly to:string;count:string;readonly fold:CompleteRuntimeFold}
/** Bucket count controls chart resolution, never the task or usage population. */
export function completeTrendFolds(query:RuntimeFactQuery,visible:boolean):CompleteTrendFold[] {
  const from=Date.parse(query.from),to=Date.parse(query.to);
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>=to) throw new Error('Original cohort interval is invalid');
  // Whole calendar buckets reuse persisted sums; only the first/last fragment
  // needs an exact boundary read. Resolution never removes a source record.
  const unit=to-from>=86400000?86400000:3600000,step=Math.max(1,Math.ceil((to-from)/unit/24))*unit,bins:CompleteTrendFold[]=[];
  for(let cursor=from;cursor<to;){const end=Math.min(to,(Math.floor(cursor/step)+1)*step);bins.push({from:new Date(cursor).toISOString(),to:new Date(end).toISOString(),count:'0',fold:emptyCompleteRuntimeFold(visible)});cursor=end;}
  return bins;
}
