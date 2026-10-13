import {sql} from 'drizzle-orm';
import type {Database} from '@crewstation/persistence';
import {registerRuntimeSignals} from '@crewstation/kernel';
export function registerSessionSignals(db:Database){return registerRuntimeSignals('session.usage',async()=>{const [row]=await db.execute(sql`SELECT count(*)::text AS streams,coalesce(sum(greatest(persisted_through-source_acknowledged_through,0)),0)::text AS backlog,count(*) FILTER(WHERE loss IS NOT NULL)::text AS lost,count(*) FILTER(WHERE drain_reason IS NOT NULL AND closure IS NULL)::text AS draining FROM session.development_usage_streams`);return ['streams','backlog','lost','draining'].map(kind=>({kind:'session.usage.'+kind,unit:kind==='backlog'?'events':'streams',value:String(row?.[kind]??'0')}));});}
