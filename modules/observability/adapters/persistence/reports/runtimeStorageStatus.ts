import {sql} from 'drizzle-orm';
import type {Database} from '@crewstation/persistence';
import {RuntimeStorageSchema,type RuntimeStorage} from '@crewstation/contracts';
/** Measurements are sampled hourly, stored once per day; opening a page never scans fact documents. */
export function runtimeStorageStatus(db:Database) {
 async function sample(){
  const [recent]=await db.execute(sql`SELECT sampled_at>clock_timestamp()-interval '1 hour' AS fresh FROM observability.runtime_storage_samples ORDER BY day DESC LIMIT 1`);if(recent?.['fresh']===true)return;
  const [sizes]=await db.execute(sql`SELECT pg_database_size(current_database())::text AS database_bytes,coalesce(sum(pg_total_relation_size(c.oid)) FILTER(WHERE c.relname NOT LIKE 'runtime_%'),0)::text AS facts_bytes,coalesce(sum(pg_total_relation_size(c.oid)) FILTER(WHERE c.relname LIKE 'runtime_%'),0)::text AS derived_bytes,coalesce(sum(pg_indexes_size(c.oid)),0)::text AS index_bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='observability' AND c.relkind='r'`);
  if(!sizes)return;const [previous]=await db.execute(sql`SELECT document,extract(epoch FROM (clock_timestamp()-sampled_at))::text AS elapsed FROM observability.runtime_storage_samples WHERE day<current_date ORDER BY day DESC LIMIT 1`),bytes=String(sizes['database_bytes']),old=previous?.['document'] as {databaseBytes?:string}|undefined,elapsed=Number(previous?.['elapsed']??0),growth=old?.databaseBytes&&elapsed>0?String((BigInt(bytes)>BigInt(old.databaseBytes)?BigInt(bytes)-BigInt(old.databaseBytes):0n)*86400n/BigInt(Math.max(1,Math.floor(elapsed)))):null;
  const value={databaseBytes:bytes,factsBytes:String(sizes['facts_bytes']),derivedBytes:String(sizes['derived_bytes']),indexBytes:String(sizes['index_bytes']),growthBytesPerDay:growth};
  await db.execute(sql`INSERT INTO observability.runtime_storage_samples(day,sampled_at,document) VALUES(current_date,clock_timestamp(),${JSON.stringify(value)}::jsonb) ON CONFLICT(day) DO UPDATE SET sampled_at=excluded.sampled_at,document=excluded.document`);
 }
 async function read():Promise<RuntimeStorage>{
  const [sample]=await db.execute(sql`SELECT sampled_at::text,document FROM observability.runtime_storage_samples ORDER BY day DESC LIMIT 1`),[queue]=await db.execute(sql`SELECT count(*)::text AS pending,min(queued_at)::text AS oldest FROM observability.runtime_task_work`),[leases]=await db.execute(sql`SELECT count(*) FILTER(WHERE NOT retiring)::text AS active,count(*) FILTER(WHERE retiring)::text AS retiring FROM observability.runtime_report_leases`),[gc]=await db.execute(sql`SELECT last_success::text,last_error,reclaimed::text FROM observability.runtime_storage_guard WHERE singleton=true`);
  return RuntimeStorageSchema.parse({sampledAt:sample?.['sampled_at']??null,databaseBytes:null,factsBytes:null,derivedBytes:null,indexBytes:null,growthBytesPerDay:null,...(sample?.['document'] as object??{}),reusableBytes:null,freeBytes:null,daysRemaining:null,pending:String(queue?.['pending']??'0'),oldestPendingAt:queue?.['oldest']??null,activeReports:String(leases?.['active']??'0'),retiringReports:String(leases?.['retiring']??'0'),reclaimed:String(gc?.['reclaimed']??'0'),lastSuccess:gc?.['last_success']??null,lastError:gc?.['last_error']??null,retentionDays:7});
 }
 return {sample,read,failed:async(error:unknown)=>{await db.execute(sql`UPDATE observability.runtime_storage_guard SET last_error=${error instanceof Error?error.message:String(error)} WHERE singleton=true`);}};
}
