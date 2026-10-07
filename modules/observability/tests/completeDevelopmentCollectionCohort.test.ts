// Original 201/1001/2001 PG fixture and EOF remain unchanged; install metadata cannot filter historical rows or four-bin CNY totals.
import {afterEach,describe,expect,test} from 'bun:test';
import {sql} from 'drizzle-orm';
import {CompleteRuntimeCallSchema,CompleteRuntimeTaskSummarySchema} from '@crewstation/contracts';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import {originalReportSnapshotSession} from '@crewstation/persistence';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '@crewstation/testkit';
import {buildCompleteRuntimeCohort} from '../application/complete-statistics/cohort';
import {buildCompleteRuntimeTask} from '../application/completeRuntimeTask';
import {completeWorkingTraversal} from '../application/completeWorkingTraversal';
import {developmentCollectionConfiguration} from '../application/complete-statistics/sourceCollection';
import {completeRuntimeLedgerSources} from '../adapters/persistence/completeRuntimeLedgerSources';
import {completeStatisticsWorkspace,observabilityMigrations} from '../wiring';
import {completeCohortFixture,completeCohortWindow,seedCompleteCohort} from './completeCohortFixture';
import type {CompleteRuntimeReportRow} from '../ports/completeRuntimeCohort';
const available=await testDatabaseAvailable();let tdb:TestDatabase;afterEach(async()=>{await tdb?.drop();});
describe.skipIf(!available)('validation metadata retains the complete original population',()=>{
 test('an unrelated selected project/profile changes only source display state; all 201 tasks, 1001 calls and 2001 captures reach EOF with original four-bin CNY',async()=>{
  tdb=await createTestDatabase([observabilityMigrations]);const f=completeCohortFixture();await seedCompleteCohort(tdb,f);const sourceCollection=developmentCollectionConfiguration([{projectId:newResourceId(),profileId:newResourceId(),profileRevision:99}])(null)!;
  await originalReportSnapshotSession(tdb.handle).run(async snapshot=>{
   const input={query:completeCohortWindow,facts:f.facts(snapshot.snapshotId),sourceCollection,snapshotId:snapshot.snapshotId,asOf:snapshot.asOf,rows:snapshot.workspace,namespace:'selected-complete-original',keyOf:jsonHash,system:true,usageWorkspace:completeStatisticsWorkspace};
   const build=await buildCompleteRuntimeCohort({...input,task:(task,namespace)=>buildCompleteRuntimeTask({...input,task,namespace,attempts:input.facts.attempts(task),ledger:completeRuntimeLedgerSources(snapshot.executor,task,snapshot.snapshotId)})}),documents:CompleteRuntimeReportRow[]=[];
   for await(const row of completeWorkingTraversal<CompleteRuntimeReportRow>(snapshot.workspace,build.readyRowsNamespace))documents.push(row.document);
   const [original]=await snapshot.executor.execute(sql`SELECT count(*)::text AS records,sum((document->'usage'->>'input')::numeric)::text AS input,sum((document->'usage'->>'cacheRead')::numeric)::text AS cache_read,sum((document->'usage'->>'cacheWrite')::numeric)::text AS cache_write,sum((document->'usage'->>'output')::numeric)::text AS output FROM observability.usage_projections`);
   expect(build.summary.tasks).toBe('201');expect(build.sourceReceipts.map(receipt=>receipt.rows)).toEqual(['201','0']);expect(build.sourceReceipts.every(receipt=>receipt.eof)).toBe(true);
   expect(build.summary.sources.map(source=>({kind:source.kind,tasks:source.tasks,collectionState:source.collectionState}))).toEqual([{kind:'business-task',tasks:'201',collectionState:'available'},{kind:'development-agent',tasks:'0',collectionState:'validation-selected'}]);
   const metrics=build.summary.metrics;expect(metrics.state).toBe('ready');if(metrics.state!=='ready')throw Error('All original rows must remain complete');expect(metrics.records).toBe(String(original!['records']));expect(metrics.executions).toBe('1001');expect(metrics.observedExecutions).toBe('1001');
   expect(metrics.tokens).toEqual({input:String(original!['input']),cacheRead:String(original!['cache_read']),cacheWrite:String(original!['cache_write']),output:String(original!['output']),total:String(BigInt(String(original!['input']))+15015n)});expect(metrics.cost).toEqual({currency:'CNY',state:'complete',amount:f.decimal(f.records.reduce((amount,_record,n)=>amount+f.pico(n),0n))});
   const tasks=documents.filter(row=>row.section==='tasks').map(row=>CompleteRuntimeTaskSummarySchema.parse(row.document)),calls=documents.filter(row=>row.section==='calls').map(row=>CompleteRuntimeCallSchema.parse(row.document));expect(tasks).toHaveLength(201);expect(new Set(tasks.map(row=>row.id))).toEqual(new Set(f.tasks.map(task=>task.id)));expect(calls).toHaveLength(1001);expect(new Set(calls.map(row=>row.recordId))).toEqual(new Set(f.records.map(record=>record.recordId)));expect(documents.filter(row=>row.section==='attempts')).toHaveLength(1001);expect(documents.filter(row=>row.section==='captures')).toHaveLength(2001);expect(calls.every(row=>row.profileName==='Original Compute Name')).toBe(true);
   expect(build.summary.durations).toEqual({state:'complete',samples:'201',p50Ms:'10000',p95Ms:'10000',maxMs:'10000'});
  });
 },120000);
});
