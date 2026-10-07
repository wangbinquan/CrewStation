// Actual PG request/cache ownership and process recovery; deliberately unavailable build never claims numeric readiness.
import {afterEach,describe,expect,test} from 'bun:test';
import {sql} from 'drizzle-orm';
import {RuntimeStatisticsQuerySchema,type ProjectId} from '@crewstation/contracts';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import {testDatabaseAvailable} from '@crewstation/testkit';
import {developmentCollectionConfiguration} from '../application/complete-statistics/sourceCollection';
import {completeRuntimeReportCache} from '../adapters/persistence/reports/reportStore';
import {completeCohortWindow} from './completeCohortFixture';
import {collectionReportFixture} from './completeDevelopmentCollection/fixture';
const available=await testDatabaseAvailable();let f:Awaited<ReturnType<typeof collectionReportFixture>>|undefined;afterEach(async()=>{await f?.close();f=undefined;});
describe.skipIf(!available)('original PG frozen collection configuration',()=>{
 test('default-off retains the exact original facts v5 cache key and stores no selection property',async()=>{
  f=await collectionReportFixture();const identity=await f.store.identity(),api=f.api(developmentCollectionConfiguration([])),report=await api.request(f.actor,null,completeCohortWindow);await api.worker.drain();const stored=(await f.store.get(report.reportId))!,request={actor:f.actor,projectId:null,filters:RuntimeStatisticsQuerySchema.parse(completeCohortWindow)};
  expect(stored.request).toEqual(request);expect('sourceCollection' in stored.request).toBe(false);expect(stored.requestKey).toBe(jsonHash({projectionVersion:2,executionFactsVersion:5,identity,request}));expect(stored.state).toBe('not-ready');expect('summary' in stored.report).toBe(false);
 },30000);
 test('selected metadata creates facts v6 keys, distinct system/project scope and a new request for a changed install revision',async()=>{
  f=await collectionReportFixture();const projectId=newResourceId() as ProjectId,profileId=newResourceId(),selected=developmentCollectionConfiguration([{projectId,profileId,profileRevision:2}]),identity=await f.store.identity(),api=f.api(selected),system=await api.request(f.actor,null,completeCohortWindow),project=await api.request(f.actor,projectId,completeCohortWindow);await api.worker.drain();
  for(const [id,scope] of [[system.reportId,null],[project.reportId,projectId]] as const){const stored=(await f.store.get(id))!;expect(stored.request.sourceCollection).toEqual(selected(scope));expect(stored.requestKey).toBe(jsonHash({projectionVersion:2,executionFactsVersion:6,identity,request:stored.request}));}expect(project.reportId).not.toBe(system.reportId);
  const changed=f.api(developmentCollectionConfiguration([{projectId,profileId,profileRevision:3}])),next=await changed.request(f.actor,null,completeCohortWindow);await changed.worker.drain();expect(next.reportId).not.toBe(system.reportId);expect((await f.store.get(system.reportId))!.request.sourceCollection).toEqual(selected(null));expect(await f.store.identity()).toEqual(identity);
 },30000);
 test('lease recovery reads the stored original selected request after config removal and never invokes current selection on status',async()=>{
  f=await collectionReportFixture();const selected=developmentCollectionConfiguration([{projectId:newResourceId(),profileId:newResourceId(),profileRevision:2}]),request={actor:f.actor,projectId:null,filters:RuntimeStatisticsQuerySchema.parse(completeCohortWindow),sourceCollection:selected(null)!},identity=await f.store.identity(),key=jsonHash({projectionVersion:2,executionFactsVersion:6,identity,request}),old=await f.store.ensure(request,key,'retired-worker/'+newResourceId(),newResourceId());
  await f.handle.db.execute(sql`UPDATE observability.runtime_reports SET lease_until=clock_timestamp()-interval '1 second' WHERE id=${old.id}`);
  const replacement=f.api(()=>{throw Error('current selection must not rewrite an original report');});await replacement.status(f.actor,null,old.id);await replacement.worker.drain();const restored=(await completeRuntimeReportCache(f.handle.db).get(old.id))!;
  expect(f.requests).toEqual([request]);expect(restored.request).toEqual(request);expect(restored.requestKey).toBe(key);expect(restored.owner).not.toBe(old.owner);expect(restored.state).toBe('not-ready');expect('summary' in restored.report).toBe(false);expect(await f.store.identity()).toEqual(identity);
 },30000);
 test('a retained original v5 status stays readable after selection is enabled; only a new request chooses v6',async()=>{
  f=await collectionReportFixture();const identity=await f.store.identity(),request={actor:f.actor,projectId:null,filters:RuntimeStatisticsQuerySchema.parse(completeCohortWindow)},key=jsonHash({projectionVersion:2,executionFactsVersion:5,identity,request}),old=await f.store.ensure(request,key,'old/'+newResourceId(),newResourceId()),gaps=[{source:'old-original',reason:'immutable old evidence'}];await f.store.unavailable(old.id,old.owner,gaps);
  const selected=developmentCollectionConfiguration([{projectId:newResourceId(),profileId:newResourceId(),profileRevision:2}]),api=f.api(selected);expect(await api.status(f.actor,null,old.id)).toEqual({reportId:old.id,state:'not-ready',gaps});expect(f.requests).toHaveLength(0);
  const next=await api.request(f.actor,null,completeCohortWindow);await api.worker.drain();expect(next.reportId).not.toBe(old.id);expect((await f.store.get(old.id))!.request).toEqual(request);expect((await f.store.get(old.id))!.requestKey).toBe(key);expect((await f.store.get(next.reportId))!.request.sourceCollection).toEqual(selected(null));
 },30000);
});
