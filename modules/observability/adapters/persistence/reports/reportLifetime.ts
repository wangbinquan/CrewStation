import {sql} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
/** Caller owns report admission. A retired identity can never be renewed or resurrected. */
export async function retainRuntimeReport(db:Executor,id:string,kind:'lazy'|'legacy') {
 const rows=await db.execute(sql`INSERT INTO observability.runtime_report_leases(id,kind) VALUES(${id},${kind}) ON CONFLICT(id) DO UPDATE SET expires_at=clock_timestamp()+interval '7 days' WHERE NOT observability.runtime_report_leases.retiring RETURNING id`);
 return rows.length===1;
}
/** Locks the newest guard row. Under RR a snapshot straddling GC must restart, never pin ghost rows. */
export async function guardRuntimeReportSnapshot(db:Executor) {
 await db.execute(sql`SELECT generation FROM observability.runtime_storage_guard WHERE singleton=true FOR SHARE`);
}
export async function retryRuntimeReportSnapshot<T>(run:()=>Promise<T>):Promise<T> {
 for(let attempt=0;;attempt++)try{return await run();}catch(error){
  let e:unknown=error,conflict=false;
  for(let depth=0;depth<8&&e&&typeof e==='object';depth++){const x=e as {code?:string;errno?:string;cause?:unknown};if(x.code==='40001'||x.errno==='40001'||x.code==='40P01'||x.errno==='40P01')conflict=true;e=x.cause;}
  if(!conflict||attempt>=3)throw error;
 }
}
