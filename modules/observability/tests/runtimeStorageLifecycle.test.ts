import {observeRuntimeStorageAnomalies} from '../adapters/persistence/projection/runtimeAnomalies';
// RFC-034: real PostgreSQL conservation and crash recovery, no production resources or models.
import {afterEach,describe,expect,test} from 'bun:test';
import {sql} from 'drizzle-orm';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '@crewstation/testkit';
import {newResourceId} from '@crewstation/kernel';
import {runMigrations} from '@crewstation/persistence';
import {runtimeCompleteReportContent,RuntimeReportPageQuerySchema,type UserId} from '@crewstation/contracts';
import {observabilityMigrations} from '../wiring';
import {collectRuntimeStorage} from '../adapters/persistence/reports/runtimeStorageGc';
import {runtimeStorageStatus} from '../adapters/persistence/reports/runtimeStorageStatus';
import {originalRuntimeSourceIdentity,completeRuntimeReportCache} from '../adapters/persistence/reports/reportStore';
import {pinnedRuntimeReports} from '../adapters/persistence/projection/pinnedRuntimeReports';
import {admitRuntimeReport} from '../adapters/persistence/reports/reportAdmission';
import {guardRuntimeReportSnapshot,retryRuntimeReportSnapshot} from '../adapters/persistence/reports/reportLifetime';
import {incrementalFixture} from './helpers/incrementalFixture';
const available=await testDatabaseAvailable();let db:TestDatabase;afterEach(async()=>{await db?.drop();});
const actor={userId:newResourceId() as UserId,isAdmin:true},filters={from:'2026-10-01T00:00:00.000Z',to:'2026-10-31T00:00:00.000Z',timezone:'UTC'};
const setup=async()=>db=await createTestDatabase([observabilityMigrations]);
const count=async(table:string)=>String((await db.db.execute(sql`SELECT count(*)::text AS n FROM ${sql.identifier('observability')}.${sql.identifier(table)}`))[0]!['n']);
describe.skipIf(!available)('RFC-034 long running storage lifecycle',()=>{
 test('upgrade grants the entire idle grace period even to reports created years ago',async()=>{
  db=await createTestDatabase([{...observabilityMigrations,files:observabilityMigrations.files.filter(f=>f.name<'0040_runtime_storage_lifecycle.sql')}]);const id=newResourceId();
  await db.db.execute(sql`INSERT INTO observability.runtime_lazy_reports(id,request_key,owner,request,report,state,created_at) VALUES(${id},'old-upgrade','owner','{}'::jsonb,'{}'::jsonb,'ready','2020-01-01T00:00:00Z')`);
  await runMigrations(db.db,[observabilityMigrations]);const [lease]=await db.db.execute(sql`SELECT expires_at>clock_timestamp()+interval '6 days' AS protected FROM observability.runtime_report_leases WHERE id=${id}`);expect(lease?.['protected']).toBe(true);await collectRuntimeStorage(db.db);expect(await count('runtime_lazy_reports')).toBe('1');
 },30000);

 test('two periods share immutable task documents and repeated exact requests allocate no new report',async()=>{
  await setup();await incrementalFixture(db,1);const cache=pinnedRuntimeReports(db.db,completeRuntimeReportCache(db.db)),request={actor,projectId:null,filters},a=await cache.ensure(request,'same','owner',newResourceId()),b=await cache.ensure(request,'same','owner',newResourceId());expect(a.id).toBe(b.id);
  const c=await cache.ensure({...request,filters:{...filters,from:'2026-10-02T00:00:00.000Z'}},'week','owner',newResourceId());expect(c.id).not.toBe(a.id);expect(await count('runtime_report_task_documents')).toBe('1');expect(await count('runtime_report_task_refs')).toBe('2');
  const [reference]=await db.db.execute(sql`SELECT document,document_key FROM observability.runtime_report_task_refs LIMIT 1`);expect(reference?.['document']).toEqual({});expect(reference?.['document_key']).not.toBeNull();
  await expect(Promise.resolve(db.db.execute(sql`UPDATE observability.runtime_report_task_documents SET document='{"changed":true}'::jsonb`))).rejects.toMatchObject({cause:{message:expect.stringContaining('identity collision')}});
 },30000);
 test('renewed page survives expiry while a retired report gets a fresh identity and no old cursor',async()=>{
  await setup();const f=await incrementalFixture(db,1),cache=pinnedRuntimeReports(db.db,completeRuntimeReportCache(db.db)),request={actor,projectId:null,filters},a=await cache.ensure(request,'request','owner',newResourceId());
  await db.db.execute(sql`UPDATE observability.runtime_report_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${a.id}`);await cache.page(a,RuntimeReportPageQuerySchema.parse({section:'calls',parent:f.task.id,pageSize:1}),null);await collectRuntimeStorage(db.db);expect(await cache.get(a.id)).toBeDefined();
  await db.db.execute(sql`UPDATE observability.runtime_report_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${a.id}`);await collectRuntimeStorage(db.db);expect(await cache.get(a.id)).toBeUndefined();const b=await cache.ensure(request,'request','owner',newResourceId());expect(b.id).not.toBe(a.id);expect(runtimeCompleteReportContent(b.report)?.summary.metrics).toEqual(runtimeCompleteReportContent(a.report)?.summary.metrics);
 },30000);
 test('deletion anchors and maintenance watermarks survive more than one sweep packet',async()=>{
  await setup();const task=newResourceId(),op=newResourceId(),project=newResourceId();
  await db.db.execute(sql`INSERT INTO observability.runtime_task_row_history(task_id,role,key,sequence,document) SELECT ${task},'public-rows','key-'||lpad(n::text,6,'0'),v,CASE WHEN v=5 THEN NULL ELSE jsonb_build_object('sequence',v) END FROM generate_series(1,601) n CROSS JOIN (VALUES(1),(5),(9)) s(v)`);
  await db.db.execute(sql`INSERT INTO observability.runtime_maintenance(id,request_key,actor_id,document) VALUES(${op},${op},${actor.userId},'{}'::jsonb)`);
  await db.db.execute(sql`INSERT INTO observability.runtime_maintenance_members(operation_id,task_id,project_id,task_key,through,header,state,row_through) VALUES(${op},${task},${project},'task-key',0,'{}'::jsonb,'pending',7)`);
  for(let n=0;n<8;n++)await collectRuntimeStorage(db.db);
  expect(await count('runtime_task_row_history')).toBe('1202');const visible=await db.db.execute(sql`SELECT * FROM observability.runtime_view_rows(${task},NULL,7,'public-rows')`);expect(visible).toHaveLength(0);
  await db.db.execute(sql`UPDATE observability.runtime_maintenance_members SET state='prepared' WHERE operation_id=${op}`);for(let n=0;n<8;n++)await collectRuntimeStorage(db.db);expect(await count('runtime_task_row_history')).toBe('601');
 },30000);
 test('notification compaction preserves the original committed clock across batches and a late commit',async()=>{
  await setup();await db.db.execute(sql`INSERT INTO observability.runtime_report_revisions(revision) OVERRIDING SYSTEM VALUE SELECT n FROM generate_series(1,2501) n`);const before=await originalRuntimeSourceIdentity(db.db);
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r),late=db.db.transaction(async tx=>{await tx.execute(sql`INSERT INTO observability.runtime_report_revisions(revision) OVERRIDING SYSTEM VALUE VALUES(9999)`);entered();await held;});
  await ready;try{for(let n=0;n<4;n++)await collectRuntimeStorage(db.db);expect(await originalRuntimeSourceIdentity(db.db)).toEqual(before);}finally{release();await late;}
  expect((await originalRuntimeSourceIdentity(db.db)).revision).toBe(String(BigInt(before.revision)+1n));await collectRuntimeStorage(db.db);expect((await originalRuntimeSourceIdentity(db.db)).revision).toBe(String(BigInt(before.revision)+1n));expect(await count('runtime_report_revisions')).toBe('0');
 },30000);
 test('write failure rolls back compaction and GC cursors; restart retries without changing any original bins or CNY',async()=>{
  await setup();const f=await incrementalFixture(db,211),before=await f.metrics(),facts=await db.db.execute(sql`SELECT meter_key,document FROM observability.usage_projections ORDER BY meter_key`),valuations=await db.db.execute(sql`SELECT meter_key,document FROM observability.execution_valuations ORDER BY meter_key`),identity=await originalRuntimeSourceIdentity(db.db),notifications=await count('runtime_report_revisions');
  await db.db.execute(sql`CREATE FUNCTION observability.fail_storage_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.last_success IS NOT NULL THEN RAISE EXCEPTION 'injected disk write failure'; END IF; RETURN NEW; END $$`);await db.db.execute(sql`CREATE TRIGGER fail_storage BEFORE UPDATE ON observability.runtime_storage_guard FOR EACH ROW EXECUTE FUNCTION observability.fail_storage_write()`);
  await expect(collectRuntimeStorage(db.db)).rejects.toMatchObject({cause:{message:'injected disk write failure'}});expect(await count('runtime_report_revisions')).toBe(notifications);expect(await originalRuntimeSourceIdentity(db.db)).toEqual(identity);await db.db.execute(sql`DROP TRIGGER fail_storage ON observability.runtime_storage_guard`);
  for(let n=0;n<4;n++)await collectRuntimeStorage(db.db);expect(await f.metrics()).toEqual(before);expect(await db.db.execute(sql`SELECT meter_key,document FROM observability.usage_projections ORDER BY meter_key`)).toEqual(facts);expect(await db.db.execute(sql`SELECT meter_key,document FROM observability.execution_valuations ORDER BY meter_key`)).toEqual(valuations);
 },60000);
 test('an RR snapshot crossing GC restarts the whole pin instead of registering a vanished history version',async()=>{
  await setup();let reads=0,release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);
  const pin=retryRuntimeReportSnapshot(()=>db.db.transaction(async tx=>{await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);await tx.execute(sql`SELECT generation FROM observability.runtime_storage_guard`);reads++;if(reads===1){entered();await held;}await admitRuntimeReport(tx);await guardRuntimeReportSnapshot(tx);return reads;}));
  await ready;try{await collectRuntimeStorage(db.db);}finally{release();}expect(await pin).toBe(2);
 },30000);
 test('storage anomalies retain unknown capacity and record transitions without unbounded duplicate history',async()=>{
  await setup();const base=await runtimeStorageStatus(db.db).read(),value={...base,freeBytes:'1000',pending:'12001',oldestPendingAt:'2026-10-13T00:00:00Z',lastError:'disk full'};
  await observeRuntimeStorageAnomalies(db.db,value,'2026-10-13T00:02:00Z');await observeRuntimeStorageAnomalies(db.db,value,'2026-10-13T00:03:00Z');expect(await count('runtime_anomaly_history')).toBe('3');
  await observeRuntimeStorageAnomalies(db.db,{...value,freeBytes:null},'2026-10-13T00:04:00Z');const [state]=await db.db.execute(sql`SELECT document->'document' AS document FROM observability.runtime_anomaly_state WHERE document->'document'->>'rule'='storage-capacity'`);expect(state?.['document']).toMatchObject({state:'firing',sourceState:'unavailable'});
  await observeRuntimeStorageAnomalies(db.db,{...base,freeBytes:'1099511627776'},'2026-10-13T00:05:00Z');const states=await db.db.execute(sql`SELECT document->'document'->>'state' AS state FROM observability.runtime_anomaly_state`);expect(states.map(s=>s['state'])).toEqual(['resolved','resolved','resolved']);
 },30000);
 test('capacity reads use retained hourly samples and leave unknown remote free space unknown',async()=>{
  await setup();const status=runtimeStorageStatus(db.db);expect((await status.read()).sampledAt).toBeNull();await status.sample();const before=await status.read();expect(BigInt(before.databaseBytes!)).toBeGreaterThan(0n);expect(before.freeBytes).toBeNull();expect(before.daysRemaining).toBeNull();await status.sample();expect((await status.read()).sampledAt).toBe(before.sampledAt);expect(await count('runtime_storage_samples')).toBe('1');await status.failed(Error('disk full'));expect((await status.read()).lastError).toBe('disk full');
 },30000);
});
