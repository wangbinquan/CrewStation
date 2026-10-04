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
