// Actual PG/cache/snapshot/work root and formal module; source-owner facts are explicit fixtures, no model calls.
import {afterEach,describe,test,expect} from 'bun:test';
import {existsSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {sql} from 'drizzle-orm';
import {PROJECT_DELETION_PHASES} from '@crewstation/contracts';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import {testDatabaseAvailable} from '@crewstation/testkit';
import {connectDatabase,originalReportSnapshotSession} from '@crewstation/persistence';
import {runtimeReportAdmissionKey} from '../ports/completeRuntimeReportCache';
import {reportDeletionFixture,expectedReportMetrics} from './reportDeletionFixture';
const available=await testDatabaseAvailable();let f:Awaited<ReturnType<typeof reportDeletionFixture>>|undefined;
afterEach(async()=>{await f?.close();f=undefined;});
async function setup(){return f=await reportDeletionFixture();}
describe.skipIf(!available)('complete report lifecycle in permanent project deletion',()=>{
 test('seal erases mixed/project caches and sealed work, verify clears a new B report, B original exact CNY/Token evidence rebuilds',async()=>{
  const f=await setup(),a=await f.ready(f.a.projectId),system=await f.ready(null),before=await f.preservedB();
  const original=(await f.store.get(a.reportId))!,manifest=(await f.handle.db.execute(sql`SELECT manifest FROM observability.runtime_reports WHERE id=${a.reportId}`))[0]!['manifest'] as Parameters<typeof f.spool.pages>[0];
  const folder=join(f.root,'runtime-reports',a.reportId,jsonHash(original.owner));mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'sealed.json'),JSON.stringify(manifest));
  const confirmed=await f.owner.inspect(f.target);expect(confirmed.complete).toBe(true);expect((await f.owner.run(f.context(confirmed,'seal'))).kind).toBe('done');expect(await f.population()).toEqual(['0','0','0','0','0']);expect(await f.spool.empty()).toBe(true);expect(existsSync(folder)).toBe(false);
  for(const id of [a.reportId,system.reportId]){await expect(f.module.api.runtimeCompleteReportStatus(f.actor,id===a.reportId?f.a.projectId:null,id)).rejects.toThrow('不存在');await expect(f.module.api.runtimeCompleteReportPage(f.actor,id===a.reportId?f.a.projectId:null,id,{section:'tasks',pageSize:37})).rejects.toThrow('不存在');}
  await expect(f.store.stage(a.reportId,original.owner,{reportId:a.reportId,ordinal:'0',previousDigest:'old',digest:'old',items:[]})).rejects.toThrow('ownership changed');await expect(f.store.publish(a.reportId,original.owner,manifest)).rejects.toThrow('ownership changed');
  const b=await f.ready(f.b.projectId);expect(b.summary.tasks).toBe('1');expect(b.summary.metrics).toMatchObject({state:'ready',tokens:{input:'1',cacheRead:'3',cacheWrite:'5',output:'7',total:'16'},cost:{currency:'CNY',state:'complete',amount:f.b.decimal(f.b.pico(0))}});expect((await f.population())[0]).toBe('1');
  for(const phase of PROJECT_DELETION_PHASES.slice(1))expect((await f.owner.run(f.context(confirmed,phase))).kind).toBe('done');expect(await f.population()).toEqual(['0','0','0','0','0']);expect(await f.preservedB()).toEqual(before);expect(await f.spool.empty()).toBe(true);
  const rebuilt=await f.ready(f.b.projectId);expect(expectedReportMetrics(rebuilt)).toEqual(expectedReportMetrics(b));expect(await f.module.api.runtimeCompleteReportPage(f.actor,f.b.projectId,rebuilt.reportId,{section:'calls',parent:f.b.tasks[0]!.id,pageSize:37})).toMatchObject({total:'1',nextCursor:null});
  await expect(f.module.api.runtimeCompleteReport(f.actor,f.a.projectId,rebuilt.header.filters)).rejects.toThrow('封闭');
 },60000);
 test('a live original remote snapshot returns waiting, releases admission on abort and preserves a usable one-connection pool',async()=>{
  const f=await setup(),confirmed=await f.owner.inspect(f.target),abort=new AbortController();let entered!:()=>void,release!:()=>void;const start=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);
  const remote=connectDatabase(f.database.url,{max:1}),original=originalReportSnapshotSession(remote).run(async s=>{await s.executor.execute(sql`SELECT 1`);entered();await hold;abort.signal.throwIfAborted();},abort.signal,runtimeReportAdmissionKey);try{await start;
  const result=await f.owner.run(f.context(confirmed,'seal'));expect(result.kind).toBe('waiting');expect((await f.database.db.execute(sql`SELECT count(*)::text AS count FROM observability.deletion_fences`)).map(row=>row['count'])).toEqual(['0']);
  abort.abort(new Error('original remote cancelled'));release();await expect(original).rejects.toThrow('cancelled');expect((await f.owner.run(f.context(confirmed,'seal'))).kind).toBe('done');expect((await f.handle.db.execute(sql`SELECT 1 AS usable`))[0]).toEqual({usable:1});
  }finally{release();await original.catch(()=>{});await remote.close();}
 });
 test('the wired local owner cancels and drains in-progress work, resumes unrelated complete requests without stopping the process',async()=>{
  const f=await setup(),confirmed=await f.owner.inspect(f.target);let entered!:()=>void;const started=new Promise<void>(r=>entered=r);f.controls.hold=true;f.controls.entered=entered;
  const building=await f.module.api.runtimeCompleteReport(f.actor,null,{from:'2026-10-03T00:00:00.000Z',to:'2026-10-04T00:00:00.000Z',timezone:'Asia/Shanghai'});expect(building.state).toBe('building');await started;
  expect((await f.owner.run(f.context(confirmed,'seal'))).kind).toBe('done');expect(await f.population()).toEqual(['0','0','0','0','0']);expect(await f.spool.empty()).toBe(true);f.controls.hold=false;f.controls.entered=undefined;
  const b=await f.ready(f.b.projectId);expect(b.state).toBe('ready');expect((await f.handle.db.execute(sql`SELECT 1 AS usable`))[0]).toEqual({usable:1});
 },30000);
 test('existing derived content without its physical owner blocks cleanup; unknown root entries are retained and never reported empty',async()=>{
  const f=await setup(),confirmed=await f.owner.inspect(f.target),unknown=join(f.root,'runtime-reports','unregistered-content');mkdirSync(unknown,{recursive:true});writeFileSync(join(unknown,'private.txt'),'must remain');
  await expect(f.owner.run(f.context(confirmed,'seal'))).rejects.toThrow();expect(readdirSync(unknown)).toEqual(['private.txt']);expect((await f.database.db.execute(sql`SELECT count(*)::text AS count FROM observability.deletion_fences`)).map(row=>row['count'])).toEqual(['0']);
  // The old empty-fixture mode cannot discard a populated report cache without the configured spool owner.
  const {observabilityDeletionRepository}=await import('../adapters/persistence/projectDeletion');const {resourceIdentityDirectory}=await import('@crewstation/persistence');
  await f.store.ensure({actor:f.actor,projectId:f.b.projectId,filters:{from:'2026-10-03T00:00:00.000Z',to:'2026-10-04T00:00:00.000Z',timezone:'Asia/Shanghai'}},newResourceId(),'original-owner',newResourceId());
  const repository=observabilityDeletionRepository({db:f.handle.db,identities:resourceIdentityDirectory(f.handle.db,()=>[]),tasks:{list:async()=>({ids:f.a.tasks.map(t=>t.id),complete:true})},assertGrant:async()=>{}});
  await expect(repository.seal(f.context(confirmed,'seal'))).rejects.toThrow('物理清理 owner');expect((await f.population())[0]).toBe('1');
 });
});
