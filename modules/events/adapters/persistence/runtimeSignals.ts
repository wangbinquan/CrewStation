import {sql} from 'drizzle-orm';
import type {Database} from '@crewstation/persistence';
import {registerRuntimeSignals} from '@crewstation/kernel';
export function registerEventSignals(db:Database){return registerRuntimeSignals('events.deliveries',async()=>{const rows=await db.execute(sql`SELECT state,count(*)::text AS count,count(*) FILTER(WHERE attempts>1)::text AS retried FROM events.deliveries GROUP BY state`);return rows.flatMap(row=>[{kind:'events.deliveries',unit:'deliveries',value:String(row['count']),labels:{state:String(row['state'])}},{kind:'events.retried',unit:'deliveries',value:String(row['retried']),labels:{state:String(row['state'])}}]);});}
