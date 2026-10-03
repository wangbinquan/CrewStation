import type {RuntimeCompleteSummary} from '@crewstation/contracts';
import {completePercentileRank} from '../../domain/completeRuntimeTiming';
import type {CompleteRuntimeCohortInput} from '../../ports/completeRuntimeCohort';
import {completeExternalSort} from '../completeExternalSort';
import {completeWorkingTraversal} from '../completeWorkingTraversal';
/** Exact nearest rank over the entire closed-task population, with no array of samples. */
export async function completeRuntimeDurations(input:CompleteRuntimeCohortInput,missing:boolean):Promise<RuntimeCompleteSummary['durations']> {
  if(missing)return {state:'not-ready',gaps:['timing-missing']};
  const sorted=await completeExternalSort({workspace:input.rows,namespace:input.namespace+'/duration-sort',records:(async function*(){for await(const row of completeWorkingTraversal<string>(input.rows,input.namespace+'/durations',input.signal))yield row.document;})(),compare:(a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0,signal:input.signal});
  const count=BigInt(sorted.rows),p50=completePercentileRank(count,1n,2n),p95=completePercentileRank(count,95n,100n);
  let seen=0n,p50Ms:string|null=null,p95Ms:string|null=null,maxMs:string|null=null;
  for await(const row of sorted.records()) {seen++;if(seen===p50)p50Ms=row;if(seen===p95)p95Ms=row;maxMs=row;}
  if(seen!==count)throw new Error('Complete duration merge did not reach original EOF');
  return {state:'complete',samples:String(count),p50Ms,p95Ms,maxMs};
}
