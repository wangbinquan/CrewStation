import {afterEach,describe,test,expect} from 'bun:test';
import {sql} from 'drizzle-orm';
import {jsonHash} from '@crewstation/kernel';
import {originalReportSnapshotSession} from '@crewstation/persistence';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '@crewstation/testkit';
import {CompleteRuntimeTaskSummarySchema,CompleteRuntimeProfileSchema,CompleteRuntimeCallSchema,CompleteRuntimeAgentSchema} from '@crewstation/contracts';
import {buildCompleteRuntimeCohort} from '../application/complete-statistics/cohort';
import {buildCompleteRuntimeTask} from '../application/completeRuntimeTask';
import {completeWorkingTraversal} from '../application/completeWorkingTraversal';
import {completeRuntimeLedgerSources} from '../adapters/persistence/completeRuntimeLedgerSources';
import {completeStatisticsWorkspace,observabilityMigrations} from '../wiring';
import {completeCohortFixture,completeCohortWindow,seedCompleteCohort} from './completeCohortFixture';
import type {CompleteRuntimeReportRow} from '../ports/completeRuntimeCohort';
const available=await testDatabaseAvailable();let tdb:TestDatabase;afterEach(async()=>{await tdb?.drop();});
async function run(missing=false) {
 tdb=await createTestDatabase([observabilityMigrations]);const f=completeCohortFixture();await seedCompleteCohort(tdb,f,missing);
 return originalReportSnapshotSession(tdb.handle).run(async snapshot=>{
  const input={query:completeCohortWindow,facts:f.facts(snapshot.snapshotId),snapshotId:snapshot.snapshotId,asOf:snapshot.asOf,rows:snapshot.workspace,namespace:'complete-test-cohort',keyOf:jsonHash,system:true,usageWorkspace:completeStatisticsWorkspace};
  const build=await buildCompleteRuntimeCohort({...input,task:(task,namespace)=>buildCompleteRuntimeTask({...input,task,namespace,attempts:input.facts.attempts(task),ledger:completeRuntimeLedgerSources(snapshot.executor,task,snapshot.snapshotId)})});
  const documents:CompleteRuntimeReportRow[]=[];for await(const row of completeWorkingTraversal<CompleteRuntimeReportRow>(snapshot.workspace,build.readyRowsNamespace))documents.push(row.document);
  const original=await snapshot.executor.execute(sql`SELECT count(*)::text AS records,sum((document->'usage'->>'input')::numeric)::text AS input,sum((document->'usage'->>'cacheRead')::numeric)::text AS cache_read,sum((document->'usage'->>'cacheWrite')::numeric)::text AS cache_write,sum((document->'usage'->>'output')::numeric)::text AS output FROM observability.usage_projections`);
  return {f,build,documents,original:original[0]!};
 });
}
describe.skipIf(!available)('complete original runtime cohort',()=>{
 test('201 tasks, 1001 Agent calls and 2001 captures reconcile every four-bin row and CNY dimension',async()=>{
  const {f,build,documents,original}=await run();expect(build.summary.tasks).toBe('201');expect(build.sourceReceipts.map(receipt=>receipt.rows)).toEqual(['201','0']);
  const metrics=build.summary.metrics;expect(metrics.state).toBe('ready');if(metrics.state!=='ready')throw new Error('Expected complete original cohort');
  expect(metrics.records).toBe(String(original['records']));expect(metrics.executions).toBe('1001');expect(metrics.observedExecutions).toBe('1001');expect(metrics.tokens).toEqual({input:String(original['input']),cacheRead:String(original['cache_read']),cacheWrite:String(original['cache_write']),output:String(original['output']),total:String(BigInt(String(original['input']))+15015n)});
  const amount=f.decimal(f.records.reduce((n,_row,index)=>n+f.pico(index),0n));expect(metrics.cost).toEqual({currency:'CNY',state:'complete',amount});
  const tasks=documents.filter(row=>row.section==='tasks').map(row=>CompleteRuntimeTaskSummarySchema.parse(row.document));expect(tasks).toHaveLength(201);expect(new Set(tasks.map(row=>row.id))).toEqual(new Set(f.tasks.map(row=>row.id)));expect(tasks.every(row=>row.projectName==='Original Project Name')).toBe(true);
  const calls=documents.filter(row=>row.section==='calls').map(row=>CompleteRuntimeCallSchema.parse(row.document));expect(calls).toHaveLength(1001);const actual=new Map(calls.map(row=>[row.recordId,row]));
  for(const record of f.records){const row=actual.get(record.recordId)!;expect(row.identity).toEqual(record.identity);expect(row.metrics.state).toBe('ready');if(row.metrics.state==='ready')expect(row.metrics.tokens).toEqual({input:record.usage.input!,cacheRead:record.usage.cacheRead!,cacheWrite:record.usage.cacheWrite!,output:record.usage.output!,total:String(BigInt(record.usage.input!)+15n)});expect(row.profileName).toBe('Original Compute Name');}
  const profiles=documents.filter(row=>row.section==='profiles').map(row=>CompleteRuntimeProfileSchema.parse(row.document));expect(profiles).toHaveLength(1);expect(profiles[0]!.metrics).toEqual(metrics);expect(profiles[0]!.tasks).toBe('1');expect(documents.filter(row=>row.section==='agent-tasks')).toHaveLength(1001);expect(documents.filter(row=>row.section==='captures')).toHaveLength(2001);const attempts=documents.filter(row=>row.section==='attempts');expect(attempts).toHaveLength(1001);expect(new Set(attempts.map(row=>row.key)).size).toBe(1001);expect(new Set(attempts.map(row=>(row.document as {id:string}).id)).size).toBe(1);
  const agents=documents.filter(row=>row.section==='agents').map(row=>CompleteRuntimeAgentSchema.parse(row.document));expect(agents).toHaveLength(1001);expect(agents.every(row=>row.tasks==='1'&&row.profileName==='Original Compute Name')).toBe(true);
  expect(build.summary.durations).toEqual({state:'complete',samples:'201',p50Ms:'10000',p95Ms:'10000',maxMs:'10000'});
 },60000);
 test('one missing native capture rejects the whole cohort instead of showing a lower-bound total',async()=>{
  const {build}=await run(true);expect(build.summary.tasks).toBe('201');expect(build.summary.metrics.state).toBe('not-ready');expect('tokens' in build.summary.metrics).toBe(false);expect('cost' in build.summary.metrics).toBe(false);
 },60000);
});
