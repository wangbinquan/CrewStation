// RFC-034: actual ledger, HTTP endpoints and policy share one PostgreSQL snapshot.
import { afterEach, describe, expect, test } from 'bun:test';
import {ProjectIdSchema,UserIdSchema, ExecutionObservationIdentitySchema, RuntimeTaskFactSchema, RuntimeCompleteReportSchema, CompleteRuntimeMetricsSchema, CompleteRuntimeAttemptSummarySchema, CompleteRuntimeProjectSchema, CompleteRuntimeProfileSchema, type RuntimeReportPage, type UserId } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient } from '@crewstation/k8s';
import { fixedClock, newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { sql, eq } from 'drizzle-orm';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {originalReportSnapshotSession} from '@crewstation/persistence';
import {jsonHash,precondition} from '@crewstation/kernel';
import {nativeCaptureSummary,type NativeCaptureDocument} from '../domain/usageProjection';
import { createObservabilityModule, observabilityMigrations } from '../wiring';
import { costVisibility,nativeCaptures,nativeSteps } from "../adapters/persistence/tables";
const available = await testDatabaseAvailable(); let tdb: TestDatabase;
const roots:string[]=[],workers:Array<{stop():Promise<void>}>=[];
afterEach(async()=>{for(const worker of workers.splice(0))await worker.stop();await tdb?.drop();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function fixture() {
  tdb = await createTestDatabase([observabilityMigrations]); const projectId = ProjectIdSchema.parse(newResourceId()), taskId = newResourceId(), subtaskId = newResourceId(), executionId = newResourceId(), adminId = newResourceId() as UserId;
  const from = '2026-09-28T00:00:00.000Z', to = '2026-09-29T00:00:00.000Z', clock = fixedClock(to);
  const task = RuntimeTaskFactSchema.parse({ id: taskId, projectId, serviceId: newResourceId(), name: 'Live task', protocol: 'v3', state: 'closed', traceId: null, createdAt: from, closedAt: '2026-09-28T00:00:20.000Z', attemptsPartial: false,
    attempts: [{ id: subtaskId, taskId, name: 'Writer', kind: 'agent', state: 'succeeded', attempt: 1, executionId, agentId: newResourceId(), profileId: newResourceId(), profileRevision: 7, createdAt: from, startedAt: from, endedAt: '2026-09-28T00:00:10.000Z' }] });
  const state = { changeVisibility: false, transaction: false, namesOffline: false };
  const root=mkdtempSync(join(tmpdir(),'cs-complete-http-'));roots.push(root);
  const module = createObservabilityModule({ db: tdb.db,reportSnapshot:originalReportSnapshotSession(tdb.handle),reportDataRoot:root,reportFacts:(executor,query,snapshotId)=>{
    const reader=<T,>(items:readonly T[])=>({next:async()=>({items,snapshotId,nextCursor:null})});
    return {tasks:{'business-task':{next:async()=>{state.transaction=executor!==tdb.db;await executor.execute(sql`SELECT 1`);if(state.changeVisibility){state.changeVisibility=false;await tdb.db.update(costVisibility).set({document:{projectId,revision:2,visibility:'project-members-and-services',updatedAt:to}}).where(eq(costVisibility.projectId,projectId));}const {attempts:_a,attemptsPartial:_p,...header}=task;return {items:query.projectId===undefined||query.projectId===projectId?[header]:[],snapshotId,nextCursor:null};}},'development-agent':reader([])},attempts:()=>reader(task.attempts),projectName:async()=>{if(state.namesOffline&&query.q)throw precondition('项目名称目录暂不可用，当前搜索无法完成，请稍后重试');return state.namesOffline?null:'Ledger project';},profileName:async()=>state.namesOffline?null:'Compute Seven'};
  }, k8s: createFakeK8sClient(), clock, isAdmin: async (id) => id === adminId, authorizer: { authorize: async () => {} }, services: { resolveServiceOfProject: async () => undefined }, slots: { slotRoles: async () => undefined },
    traces: { environments: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] }, deliveries: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] }, businessTasks: { list: async () => [] }, sessions: { summarize: async () => [], events: async () => [] } },

  });
  const identity = ExecutionObservationIdentitySchema.parse({ projectId: task.projectId, taskId: task.id, subtaskId: task.attempts[0]!.id, executionId: task.attempts[0]!.executionId!, executionGeneration: 1 });
  await module.api.ingestExecutionUsage({ projectId: identity.projectId, taskId: identity.taskId, sourceId: 'runner', expectedCursor: null, nextCursor: '1', events: [{ eventId: 'usage-1', measurement: { kind: 'usage', identity, sourceId: 'runner', recordId: 'first', revision: 1, occurredAt: from, observedAt: from, adapterVersion: 'test', modelRef: null, reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', scope: {root:'original-root',session:'original-root',parentSession:null,ancestors:[],turn:'original-turn',turnIndex:0,level:'request'}, coveredThroughTurn: null, basis: { kind: 'invocation' }, usage: { input: '100', output: '5', cacheRead: '0', cacheWrite: '0' } } }] });
  const taskKey=jsonHash({projectId,taskId}),document:NativeCaptureDocument={id:'original-http-capture',identity,sourceId:'runner',began:true,baselineRoot:'original-root',historicalRevisionGap:false,proof:{contract:'opencode-child-steps-v1',lineageKey:'original-http-lineage',turn:'original-turn',turnIndex:0,state:'complete',root:'original-root',observedAt:from,baseline:{kind:'fresh',fingerprint:null},fingerprint:'original-http-fingerprint',sessions:1,steps:1,emitted:1,baselineSteps:0,priorRevisionGap:false,issues:[]}};
  await tdb.db.insert(nativeCaptures).values({id:document.id,taskKey,sourceId:document.sourceId,turn:document.proof.turn,lineageKey:document.proof.lineageKey,root:document.proof.root,finalized:true,document,summary:nativeCaptureSummary(document,{steps:1,baselines:0,unresolved:0,revised:0})});
  await tdb.db.insert(nativeSteps).values({captureId:document.id,recordId:'first',taskKey,nativeKey:'original-http-native-key',root:'original-root',revision:1,fingerprint:'original-http-step-fingerprint'});workers.push(...module.reportWorkers);
  const app = createApp({ name: 'runtime-statistics' }); for (const route of module.http) app.route('/', route);
  return { app, state, task, from, to, headers: { 'x-cs-user-id': adminId }, query: '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) };
}
async function settled(f:Awaited<ReturnType<typeof fixture>>,path:string) {
 let response=await f.app.request(path,{headers:f.headers}),report=RuntimeCompleteReportSchema.parse(await response.json());
 expect([200,202]).toContain(response.status);const base=path.slice(0,path.indexOf('/observability/')+'/observability'.length);
 while(report.state==='building'){response=await f.app.request(base+'/reports/'+report.reportId,{headers:f.headers});report=RuntimeCompleteReportSchema.parse(await response.json());}
 return report;
}
async function rows<T>(f:Awaited<ReturnType<typeof fixture>>,projectId:string|null,reportId:string,section:string,parent?:string) {
 const base=projectId?'/v1/projects/'+projectId:'/v1/admin',query=new URLSearchParams({section,pageSize:'37',...(parent?{parent}:{})});
 const response=await f.app.request(base+'/observability/reports/'+reportId+'/pages?'+query,{headers:f.headers});expect(response.status).toBe(200);return await response.json() as RuntimeReportPage<T>;
}
describe.skipIf(!available)('RFC-034 persisted complete runtime statistics',()=>{
 test('system/project totals and task detail come from the complete committed ledger with distinct projections',async()=>{
  const f=await fixture(),page=await settled(f,'/v1/admin/observability/statistics'+f.query);expect(page.state).toBe('ready');if(page.state!=='ready')throw new Error(JSON.stringify(page));
  const metrics=CompleteRuntimeMetricsSchema.parse(page.summary.metrics);expect(metrics.state).toBe('ready');if(metrics.state!=='ready')throw new Error('Complete metrics missing');expect(metrics.tokens).toEqual({input:'100',cacheRead:'0',cacheWrite:'0',output:'5',total:'105'});expect(metrics.cost).toEqual({currency:'CNY',state:'unpriced',amount:null});
  expect((await rows(f,null,page.reportId,'models')).items).toHaveLength(1);expect(CompleteRuntimeProjectSchema.parse((await rows(f,null,page.reportId,'projects')).items[0]).projectName).toBe('Ledger project');expect(CompleteRuntimeProfileSchema.parse((await rows(f,null,page.reportId,'profiles')).items[0]).profileName).toBe('Compute Seven');expect(f.state.transaction).toBe(true);
  const project=await settled(f,'/v1/projects/'+f.task.projectId+'/observability/statistics'+f.query);expect(project.state).toBe('ready');if(project.state!=='ready')throw new Error(JSON.stringify(project));expect(project.summary.metrics).toMatchObject({state:'ready',cost:{state:'hidden',amount:null}});expect(CompleteRuntimeProfileSchema.parse((await rows(f,f.task.projectId,project.reportId,'profiles')).items[0]).profileName).toBe('Compute Seven');expect('models' in project.summary).toBe(false);
  for(const projectId of [null,f.task.projectId]){const path=projectId?'/v1/projects/'+projectId:'/v1/admin',detail=await settled(f,path+'/observability/tasks/'+f.task.id);expect(detail.state).toBe('ready');if(detail.state!=='ready')throw new Error(JSON.stringify(detail));const attempts=await rows(f,projectId,detail.reportId,'attempts',f.task.id);expect(attempts.total).toBe('1');expect(CompleteRuntimeAttemptSummarySchema.parse(attempts.items[0]).metrics).toMatchObject({state:'ready',tokens:{total:'105'}});const tasks=await rows<{timing:{intervals:{activeUnionMs:string}}}>(f,projectId,detail.reportId,'tasks');expect(tasks.items[0]!.timing.intervals.activeUnionMs).toBe('10000');}
  expect((await f.app.request('/v1/admin/observability/statistics?from=invalid',{headers:f.headers})).status).toBe(400);
 });
 test('policy changes committed during the owner read do not drift into the same statistics snapshot',async()=>{
  const f=await fixture();await tdb.db.insert(costVisibility).values({projectId:f.task.projectId,revision:1,document:{projectId:f.task.projectId,revision:1,visibility:'hidden',updatedAt:f.from}});f.state.changeVisibility=true;
  const path='/v1/projects/'+f.task.projectId+'/observability/statistics'+f.query,first=await settled(f,path);expect(first).toMatchObject({state:'ready',summary:{metrics:{state:'ready',cost:{state:'hidden'}}}});
  const second=await settled(f,path);expect(second).toMatchObject({state:'ready',summary:{metrics:{state:'ready',cost:{state:'unpriced'}}}});expect(second.reportId).not.toBe(first.reportId);
 });
 test.each([true,false])('project report visibility keeps historical hidden snapshots and rechecks the current policy for admin=%s',async(admin)=>{
  const f=await fixture();if(!admin)f.headers={'x-cs-user-id':UserIdSchema.parse(newResourceId())};
  const base='/v1/projects/'+f.task.projectId+'/observability',hidden=await settled(f,base+'/statistics'+f.query);
  expect(hidden).toMatchObject({state:'ready',summary:{metrics:{state:'ready',cost:{state:'hidden',amount:null}}}});
  await tdb.db.insert(costVisibility).values({projectId:f.task.projectId,revision:1,document:{projectId:f.task.projectId,revision:1,visibility:'project-members-and-services',updatedAt:f.to}});
  const old=await f.app.request(base+'/reports/'+hidden.reportId,{headers:f.headers});expect(old.status).toBe(200);expect(await old.json()).toMatchObject({state:'ready',summary:{metrics:{cost:{state:'hidden',amount:null}}}});
  expect((await rows(f,f.task.projectId,hidden.reportId,'tasks')).total).toBe('1');
  const visible=await settled(f,base+'/statistics'+f.query);expect(visible).toMatchObject({state:'ready',summary:{metrics:{cost:{state:'unpriced',amount:null}}}});expect(visible.reportId).not.toBe(hidden.reportId);
  await tdb.db.update(costVisibility).set({revision:2,document:{projectId:f.task.projectId,revision:2,visibility:'hidden',updatedAt:f.to}}).where(eq(costVisibility.projectId,f.task.projectId));
  for(const suffix of ['', '/pages?section=tasks&pageSize=37']){const denied=await f.app.request(base+'/reports/'+visible.reportId+suffix,{headers:f.headers});expect(denied.status).toBe(412);expect('summary' in await denied.json()).toBe(false);}
  const kept=await f.app.request(base+'/reports/'+hidden.reportId,{headers:f.headers});expect(kept.status).toBe(200);expect(await kept.json()).toMatchObject({summary:{metrics:{cost:{state:'hidden',amount:null}}}});
 });
 test('unavailable directory names keep complete numbers, while an unresolved name filter publishes no statistics',async()=>{
  const f=await fixture();f.state.namesOffline=true;const page=await settled(f,'/v1/admin/observability/statistics'+f.query);expect(page.state).toBe('ready');if(page.state!=='ready')throw new Error(JSON.stringify(page));expect(page.summary.metrics).toMatchObject({state:'ready',tokens:{total:'105'}});expect(CompleteRuntimeProjectSchema.parse((await rows(f,null,page.reportId,'projects')).items[0]).projectName).toBeNull();expect(CompleteRuntimeProfileSchema.parse((await rows(f,null,page.reportId,'profiles')).items[0]).profileName).toBeNull();
  const filtered=await settled(f,'/v1/admin/observability/statistics'+f.query+'&q=Ledger%20project');expect(filtered).toMatchObject({state:'failed',error:'项目名称目录暂不可用，当前搜索无法完成，请稍后重试'});expect('summary' in filtered).toBe(false);
 });
 test('removed project and system CSV operations return not found',async()=>{
  const f=await fixture();for(const path of ['/v1/admin/observability/exports','/v1/projects/'+f.task.projectId+'/observability/exports'])expect((await f.app.request(path,{method:'POST',headers:f.headers})).status).toBe(404);
 });
});
