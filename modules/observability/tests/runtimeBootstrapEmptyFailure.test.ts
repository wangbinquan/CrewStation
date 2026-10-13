// RFC-034: an unknown producer error may have an empty message. Persisted
// failure is explicit and retryable, then real bootstrap restores the same facts.
import {afterEach,expect,test} from 'bun:test';
import {testDatabaseAvailable} from '@crewstation/testkit';
import {sql} from 'drizzle-orm';
import {runtimeCompleteReportContent,ProjectIdSchema} from '@crewstation/contracts';
import {incrementalRuntimeTaskCache} from '../adapters/persistence/projection/incrementalRuntimeTaskCache';
import {completeFactsFixture} from './completeFactsFixture';
import {originalRuntimeSourceIdentity,originalRuntimeReportIdentity} from '../adapters/persistence/reports/reportStore';
import {completeCohortWindow} from './completeCohortFixture';
const available=await testDatabaseAvailable();let f:Awaited<ReturnType<typeof completeFactsFixture>>|undefined;
afterEach(async()=>{await f?.close();f=undefined;});
test.skipIf(!available).each(['','   '])('empty producer failure %p cannot remain building and real recovery retains the original records',async message=>{
 f=await completeFactsFixture({feePolicyCohort:true});const original=await f.tdb.db.execute(sql`SELECT meter_key,document FROM observability.usage_projections ORDER BY meter_key`);
 await incrementalRuntimeTaskCache(f.tdb.db).failed(new Error(message));
 const failed=await f.module.api.runtimeCompleteReport(f.actor,null,completeCohortWindow);expect(failed).toMatchObject({state:'failed',retryable:true});if(failed.state!=='failed')throw new Error('Explicit failure lost');expect(failed.error.trim().length).toBeGreaterThan(0);expect('summary' in failed).toBe(false);
 const restored=await f.settle(null);expect(restored.state).not.toBe('building');expect(restored.state).not.toBe('failed');expect(runtimeCompleteReportContent(restored)?.summary.tasks).toBe('3');
 expect(await f.tdb.db.execute(sql`SELECT meter_key,document FROM observability.usage_projections ORDER BY meter_key`)).toEqual(original);
 expect(Array.from(await f.tdb.db.execute(sql`SELECT done,last_error,failed_at FROM observability.runtime_task_bootstrap`))).toEqual([{done:true,last_error:null,failed_at:null}]);
});

test.skipIf(!available).each(['system','project'] as const)('empty %s bootstrap recovery publishes a new derived identity while the old failure and original source remain unchanged',async scope=>{
 f=await completeFactsFixture({emptyCohort:true});const project=scope==='system'?null:ProjectIdSchema.parse(f.f.projectId),original=await originalRuntimeSourceIdentity(f.tdb.db);f.controls.broken=true;
 for(const worker of f.module.reportWorkers)await worker.drain();const failed=await f.module.api.runtimeCompleteReport(f.actor,project,completeCohortWindow);expect(failed).toMatchObject({state:'failed',retryable:true});
 const before=await originalRuntimeReportIdentity(f.tdb.db);f.controls.broken=false;const recovered=await f.settle(project);expect(recovered.state).toBe('ready');expect(recovered.reportId).not.toBe(failed.reportId);expect(runtimeCompleteReportContent(recovered)?.summary).toMatchObject({tasks:'0',metrics:{state:'not-applicable'}});
 expect(await originalRuntimeSourceIdentity(f.tdb.db)).toEqual(original);expect(await f.module.api.runtimeCompleteReportStatus(f.actor,project,failed.reportId)).toEqual(failed);
 const after=await originalRuntimeReportIdentity(f.tdb.db);expect(after.bootstrapCompleted).toBe(true);expect(before.bootstrapCompleted).toBe(false);expect(BigInt(after.revision)).toBeGreaterThan(BigInt(before.revision));
 await incrementalRuntimeTaskCache(f.tdb.db).finishBootstrap();expect(await originalRuntimeReportIdentity(f.tdb.db)).toEqual(after);expect((await f.settle(project)).reportId).toBe(recovered.reportId);
 for(const table of ['usage_projections','execution_valuations','native_captures'] as const)expect((await f.tdb.db.execute(sql`SELECT count(*)::text AS count FROM ${sql.identifier('observability')}.${sql.identifier(table)}`))[0]?.['count']).toBe('0');
},30000);
