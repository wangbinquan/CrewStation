import {sql} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import {emptyCompleteRuntimeFold,type CompleteRuntimeFold} from '../../../domain/completeRuntimeMetrics';
import {runtimeOccurrenceDeltas} from '../../../domain/runtime/runtimeOccurrenceDelta';
import {applyRuntimeDailyDeltas} from '../projection/runtimeDailyAggregate';
interface Scope {ownerId:string;projectId:string|null;sourceKind:string;key:string;execution:string;at:string|null}
const hour=(at:string|null)=>at===null?'unknown':new Date(Math.floor(Date.parse(at)/3600000)*3600000).toISOString();
async function change(tx:Executor,s:Scope,delta:CompleteRuntimeFold,sign:1|-1){
 const h=hour(s.at),[stored]=await tx.execute(sql`SELECT document,gap_counts FROM observability.runtime_occurrence_task_hours WHERE task_id=${s.ownerId} AND hour=${h} FOR UPDATE`),before=stored?.['document'] as CompleteRuntimeFold|undefined,next=structuredClone(before??emptyCompleteRuntimeFold(true)),gaps={...(stored?.['gap_counts'] as Record<string,string>??{})};
 const [other]=await tx.execute(sql`SELECT EXISTS(SELECT 1 FROM observability.runtime_occurrence WHERE task_id=${s.ownerId} AND observability.occurrence_hour(occurred_at)=${h} AND execution_key=${s.execution} AND key<>${s.key}) AS value`),adjustment=other?.['value']===true?0n:BigInt(sign);
 next.executions=String(BigInt(next.executions)+adjustment);next.observedExecutions=next.executions;
 const add=(a:string,b:string)=>{const n=BigInt(a)+BigInt(sign)*BigInt(b);if(n<0n)throw Error('Occurrence record lost original hour contribution');return String(n);};
 for(const b of ['input','cacheRead','cacheWrite','output'] as const){next.tokens[b]=add(next.tokens[b],delta.tokens[b]);next.bucketRecords[b]=add(next.bucketRecords[b],delta.bucketRecords[b]);}
 for(const f of ['records','pricedRecords','picos'] as const)next[f]=add(next[f],delta[f]);next.partiallyPricedRecords=add(next.partiallyPricedRecords??'0',delta.partiallyPricedRecords??'0');next.priced=next.pricedRecords===next.records;
 for(const reason of new Set(delta.gaps)){const n=BigInt(gaps[reason]??'0')+BigInt(sign);if(n<0n)throw Error('Occurrence gap membership missing');if(n===0n)delete gaps[reason];else gaps[reason]=String(n);}next.gaps=Object.keys(gaps);
 const after=next.records==='0'?null:next;await applyRuntimeDailyDeltas(tx,runtimeOccurrenceDeltas({projectId:s.projectId,sourceKind:s.sourceKind,hour:h},before,after),'occurrence-hour');
 if(!after)await tx.execute(sql`DELETE FROM observability.runtime_occurrence_task_hours WHERE task_id=${s.ownerId} AND hour=${h}`);
 else await tx.execute(sql`INSERT INTO observability.runtime_occurrence_task_hours(task_id,project_id,source_kind,hour,document,gap_counts) VALUES(${s.ownerId},${s.projectId??''},${s.sourceKind},${h},${JSON.stringify(next)}::jsonb,${JSON.stringify(gaps)}::jsonb) ON CONFLICT(task_id,hour) DO UPDATE SET document=excluded.document,gap_counts=excluded.gap_counts`);
 if(sign===-1&&other?.['value']!==true)await tx.execute(sql`DELETE FROM observability.runtime_occurrence_hour_executions WHERE task_id=${s.ownerId} AND hour=${h} AND execution_key=${s.execution}`);
 if(sign===1)await tx.execute(sql`INSERT INTO observability.runtime_occurrence_hour_executions VALUES(${s.ownerId},${s.projectId??''},${s.sourceKind},${h},${s.execution}) ON CONFLICT DO NOTHING`);
}
export async function patchOccurrenceRecord(tx:Executor,s:Scope,fold:CompleteRuntimeFold|null){
 const [old]=await tx.execute(sql`SELECT execution_key,occurred_at,document FROM observability.runtime_occurrence WHERE task_id=${s.ownerId} AND key=${s.key} FOR UPDATE`);
 if(old)await change(tx,{...s,execution:String(old['execution_key']),at:old['occurred_at']===null?null:new Date(String(old['occurred_at'])).toISOString()},old['document'] as CompleteRuntimeFold,-1);
 if(!fold){await tx.execute(sql`DELETE FROM observability.runtime_occurrence WHERE task_id=${s.ownerId} AND key=${s.key}`);return;}
 await change(tx,s,fold,1);await tx.execute(sql`INSERT INTO observability.runtime_occurrence(task_id,project_id,source_kind,key,execution_key,occurred_at,document) VALUES(${s.ownerId},${s.projectId??''},${s.sourceKind},${s.key},${s.execution},${s.at}::timestamptz,${JSON.stringify(fold)}::jsonb) ON CONFLICT(task_id,key) DO UPDATE SET execution_key=excluded.execution_key,occurred_at=excluded.occurred_at,document=excluded.document`);
}
