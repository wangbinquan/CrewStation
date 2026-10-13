import {sql} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import {RUNTIME_DAILY_FIELDS,type RuntimeDailyDelta} from '../../../domain/runtime/runtimeDailyDelta';
export async function applyRuntimeDailyDeltas(tx:Executor,deltas:readonly RuntimeDailyDelta[],granularity:'day'|'occurrence-hour'='day'){
 const table=sql`${sql.identifier('observability')}.${sql.identifier(granularity==='day'?'runtime_daily_aggregates':'runtime_occurrence_hours')}`;
 const position=(day:string)=>granularity==='day'?sql`${day}::date`:sql`${day}`;for(const delta of deltas){
 await tx.execute(sql`INSERT INTO ${table}(scope,day,source_kind) VALUES(${delta.scope},${position(delta.day)},${delta.sourceKind}) ON CONFLICT(scope,day,source_kind) DO NOTHING`);
 const [previous]=await tx.execute(sql`SELECT gaps FROM ${table} WHERE scope=${delta.scope} AND day=${position(delta.day)} AND source_kind=${delta.sourceKind} FOR UPDATE`),gaps={...(previous?.['gaps'] as Record<string,string>??{})};
 for(const [key,value]of Object.entries(delta.gaps)){const count=BigInt(gaps[key]??'0')+BigInt(value);if(count<0n)throw Error('Original daily gap membership missing');if(count===0n)delete gaps[key];else gaps[key]=String(count);}
 const updates=RUNTIME_DAILY_FIELDS.map(key=>sql`${sql.identifier(key)}=${sql.identifier(key)}+${delta.numbers[key]}::numeric`);
 await tx.execute(sql`UPDATE ${table} SET ${sql.join(updates,sql`,`)},gaps=${JSON.stringify(gaps)}::jsonb WHERE scope=${delta.scope} AND day=${position(delta.day)} AND source_kind=${delta.sourceKind}`);
}}
