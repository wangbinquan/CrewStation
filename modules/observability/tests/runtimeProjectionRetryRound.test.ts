// RFC-034: a slow successful Task can outlast the retry delay. That must not
// make the same poisoned Task re-enter one EOF round or starve the remainder.
import {expect,test} from 'bun:test';
import {createTestDatabase,testDatabaseAvailable} from '@crewstation/testkit';
import {noopLogger} from '@crewstation/kernel';
import {sql} from 'drizzle-orm';
import {observabilityMigrations} from '../wiring';
import {incrementalRuntimeTaskCache} from '../adapters/persistence/projection/incrementalRuntimeTaskCache';
import {incrementalRuntimeTasks} from '../workers/incrementalRuntimeTasks';
const available=await testDatabaseAvailable();
test.skipIf(!available)('one database-clock round keeps a failed original work item pending and reaches a slow successful item exactly once',async()=>{
 const tdb=await createTestDatabase([observabilityMigrations]),cache=incrementalRuntimeTaskCache(tdb.db),seen:string[]=[];
 await cache.enqueue(['a-poison','z-valid']);
 const worker=incrementalRuntimeTasks({inventory:async()=>{},bootstrapDone:async()=>true,finishBootstrap:async()=>{},checkpoint:cache.checkpoint,pending:cache.pending,acknowledge:cache.acknowledge,stop:()=>{},qualify:async work=>{seen.push(work.key);if(work.key==='a-poison')throw new Error('original source unavailable');await Bun.sleep(2100);await cache.acknowledge(work);}},noopLogger);
 try{await worker.drain();expect(seen).toEqual(['a-poison','z-valid']);expect(Array.from(await tdb.db.execute(sql`SELECT key FROM observability.runtime_task_work ORDER BY key`))).toEqual([{key:'a-poison'}]);}
 finally{await worker.stop();await tdb.drop();}
});
