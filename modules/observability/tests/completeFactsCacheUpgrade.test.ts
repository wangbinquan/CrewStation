// Deploying sealed-facts support must not reuse an old unavailable result for the same unchanged source.
import {afterEach,expect,test} from 'bun:test';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import {RuntimeStatisticsQuerySchema,type RuntimeCompleteReport} from '@crewstation/contracts';
import {testDatabaseAvailable} from '@crewstation/testkit';
import {completeRuntimeReportCache} from '../adapters/persistence/reports/reportStore';
import {completeFactsFixture} from './completeFactsFixture';
import {completeCohortWindow} from './completeCohortFixture';
const available=await testDatabaseAvailable();let fixture:Awaited<ReturnType<typeof completeFactsFixture>>|undefined;
afterEach(async()=>{await fixture?.close();fixture=undefined;});
test.skipIf(!available)('same original revision gets a new facts format while the old unavailable report stays immutable',async()=>{
 const f=fixture=await completeFactsFixture(),cache=completeRuntimeReportCache(f.tdb.db),identity=await cache.identity(),request={actor:f.actor,projectId:null,filters:RuntimeStatisticsQuerySchema.parse(completeCohortWindow)},oldId=newResourceId(),owner='old-format/'+newResourceId(),gaps=[{source:'original-cohort',reason:'native-capture-incomplete'}];
 const old=await cache.ensure(request,jsonHash({projectionVersion:2,identity,request}),owner,oldId);await cache.unavailable(old.id,owner,gaps);
 const legacy:RuntimeCompleteReport={reportId:old.id,state:'not-ready',gaps};expect(await f.module.api.runtimeCompleteReportStatus(f.actor,null,old.id)).toEqual(legacy);expect(await cache.identity()).toEqual(identity);
 const current=await f.settle(null);expect(current.reportId).not.toBe(old.id);expect(current.state).toBe('not-ready');if(current.state!=='not-ready'||!current.facts)throw new Error('New sealed original execution facts missing after upgrade');
 expect(current.facts.summary.tasks).toBe('201');expect(current.facts.header.sourceRevision).toBe(identity.revision);expect(current.facts.header.generation).toBe(identity.generation);expect(current.facts.summary.metrics.state).toBe('not-ready');expect(current.facts.summary.metrics).not.toHaveProperty('tokens');expect(current.facts.summary.metrics).not.toHaveProperty('cost');
 expect(await f.module.api.runtimeCompleteReportStatus(f.actor,null,old.id)).toEqual(legacy);expect(await cache.identity()).toEqual(identity);
},60000);

test.skipIf(!available)('the original masked Task format gets a new private cache identity without changing generation or its legacy report',async()=>{
 const f=fixture=await completeFactsFixture({completeSibling:true}),cache=completeRuntimeReportCache(f.tdb.db),identity=await cache.identity(),request={actor:f.actor,projectId:null,filters:RuntimeStatisticsQuerySchema.parse(completeCohortWindow)},owner='task-format-one/'+newResourceId(),gaps=[{source:'old-masked-tasks',reason:'native-capture-incomplete'}];
 const old=await cache.ensure(request,jsonHash({projectionVersion:2,executionFactsVersion:1,identity,request}),owner,newResourceId());await cache.unavailable(old.id,owner,gaps);const legacy:RuntimeCompleteReport={reportId:old.id,state:'not-ready',gaps};
 const current=await f.settle(null);expect(current.reportId).not.toBe(old.id);expect(current.state).toBe('not-ready');if(current.state!=='not-ready'||!current.facts)throw new Error('New independent Task metrics facts missing');expect(current.facts.header.generation).toBe(identity.generation);expect(current.facts.header.sourceRevision).toBe(identity.revision);expect(current.facts.header.projectionVersion).toBe(2);
 const page=await f.module.api.runtimeCompleteReportPage(f.actor,null,current.reportId,{section:'tasks',rowKey:f.sibling!.task.id,pageSize:37});expect(page.total).toBe('1');expect(page.items[0]).toMatchObject({metrics:{state:'ready',tokens:{input:'3',cacheRead:'9',cacheWrite:'15',output:'21',total:'48'},cost:{currency:'CNY',amount:'0.0002235'}}});expect(page.nextCursor).toBeNull();expect(await f.module.api.runtimeCompleteReportStatus(f.actor,null,old.id)).toEqual(legacy);expect(await cache.identity()).toEqual(identity);
},60000);

// Version two already had sealed Task facts; the recorded-usage generation must also supersede it immutably.
test.skipIf(!available)('same revision gets received values while the sealed version-two unavailable report remains unchanged',async()=>{
 const f=fixture=await completeFactsFixture({feePolicyCohort:true}),cache=completeRuntimeReportCache(f.tdb.db),identity=await cache.identity(),request={actor:f.actor,projectId:null,filters:RuntimeStatisticsQuerySchema.parse(completeCohortWindow)},owner='received-format/'+newResourceId(),gaps=[{source:'old-received-mask',reason:'native-capture-unobserved'}];
 const old=await cache.ensure(request,jsonHash({projectionVersion:2,executionFactsVersion:2,identity,request}),owner,newResourceId());await cache.unavailable(old.id,owner,gaps);const legacy:RuntimeCompleteReport={reportId:old.id,state:'not-ready',gaps};
 const current=await f.settle(null);expect(current.reportId).not.toBe(old.id);expect(current.state).toBe('not-ready');if(current.state!=='not-ready'||!current.facts)throw new Error('Received facts missing');expect(current.facts.header.generation).toBe(identity.generation);expect(current.facts.header.sourceRevision).toBe(identity.revision);expect(current.facts.summary.metrics).toMatchObject({recordedUsage:{tokens:{input:'1',cacheRead:'3',cacheWrite:'5',output:'7',total:'16'}},recordedCost:{currency:'CNY',amount:'0.0000745'}});expect(await f.module.api.runtimeCompleteReportStatus(f.actor,null,old.id)).toEqual(legacy);expect(await cache.identity()).toEqual(identity);
},60000);
