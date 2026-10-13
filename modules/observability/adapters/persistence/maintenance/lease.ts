import {admitRuntimeReport} from '../reports/reportAdmission';
import {sql} from 'drizzle-orm';
import type {Database,Executor} from '@crewstation/persistence';
import {newResourceId} from '@crewstation/kernel';
export class MaintenanceLeaseLost extends Error {}
/** Every packet write locks and verifies its durable lease; a replaced process cannot commit stale progress. */
export function runtimeMaintenanceLease(base:Database){
 return async(action:(db:Database,row:Record<string,unknown>)=>Promise<void>)=>{
  const owner=newResourceId(),[row]=await base.execute(sql`UPDATE observability.runtime_maintenance m SET lease_id=${owner},lease_until=clock_timestamp()+interval '3 minutes' WHERE id=(SELECT id FROM observability.runtime_maintenance WHERE document->>'state' IN('preparing','running') AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY document->>'createdAt',id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,actor_id,document`);
  if(!row)return;
  const id=String(row['id']);
  const guard=async(tx:Executor)=>{await admitRuntimeReport(tx);const [held]=await tx.execute(sql`UPDATE observability.runtime_maintenance SET lease_until=clock_timestamp()+interval '3 minutes' WHERE id=${id} AND lease_id=${owner} RETURNING id`);if(!held)throw new MaintenanceLeaseLost('维护作业已由另一进程接续');};
  const db=new Proxy(base,{get(target,key,receiver){if(key==='execute')return (query:Parameters<Database['execute']>[0])=>base.transaction(async tx=>{await guard(tx);return tx.execute(query);});if(key==='transaction')return (work:(tx:Executor)=>Promise<unknown>)=>base.transaction(async tx=>{await guard(tx);return work(tx);});const member=Reflect.get(target,key,receiver);return typeof member==='function'?member.bind(target):member;}});
  const timer=setInterval(()=>{void base.execute(sql`UPDATE observability.runtime_maintenance SET lease_until=clock_timestamp()+interval '3 minutes' WHERE id=${id} AND lease_id=${owner}`).catch(()=>undefined);},30000);
  try{await action(db,row);}finally{clearInterval(timer);await base.execute(sql`UPDATE observability.runtime_maintenance SET lease_id=NULL,lease_until=NULL WHERE id=${id} AND lease_id=${owner}`);}
 };
}
