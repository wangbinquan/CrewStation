import { ProjectIdSchema, ExecutionObservationIdentitySchema, RuntimeTaskFactSchema, RuntimeCompleteReportSchema, type RuntimeCompleteReport, type RuntimeReportSection, type RuntimeReportPage, type Actor, type ProjectId, type UsageExecutionIdentity } from '@crewstation/contracts';
import type { TestDatabase } from '@crewstation/testkit';
import { fixedClock, forbidden, jsonHash, newResourceId } from '@crewstation/kernel';
import { createFakeK8sClient } from '@crewstation/k8s';
import { sql } from 'drizzle-orm';
import { createObservabilityModule } from '../wiring';
import { originalReportSnapshotSession } from '@crewstation/persistence';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nativeCaptureSummary, type NativeCaptureDocument } from '../domain/usageProjection';
import { nativeCaptures, nativeSteps } from '../adapters/persistence/tables';
import { drizzleUsageLedger, drizzleExecutionValuations } from '../adapters/persistence/drizzleUsageLedger';
export const statisticsWindow = { from: '2026-09-30T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', timezone: 'Asia/Shanghai' };
export const statisticsModel = { provider: 'observed-provider', model: 'actual-model', condition: null };
export async function developmentStatisticsFixture(tdb: TestDatabase, sharedProfile = false) {
  const projectId = ProjectIdSchema.parse(newResourceId()), workspaceId = newResourceId(), profileId = newResourceId(), serviceId = newResourceId();
  const facts = Array.from({ length: 2 }, (_, n) => {
    const i = { sourceKind: 'development-agent', projectId, taskId: workspaceId, agentId: newResourceId(), executionId: newResourceId(), executionGeneration: 1 };
    return RuntimeTaskFactSchema.parse({ id: i.executionId, projectId, serviceId, name: i.agentId, protocol: 'development', state: 'closed', createdAt: statisticsWindow.from, closedAt: null, traceId: 'shared-trace', attemptsPartial: false,
      source: { kind: 'development-agent', identity: i, workspaceName: null }, attempts: [{ id: i.agentId, taskId: workspaceId, name: i.agentId, kind: 'agent', state: 'closed', attempt: 1, agentId: i.agentId, executionId: i.executionId,
        profileId: n === 0 || sharedProfile ? profileId : newResourceId(), profileName: n === 0 || sharedProfile ? 'Accepted Compute A' : 'Accepted Compute B', profileRevision: 7, createdAt: statisticsWindow.from, startedAt: null, endedAt: null }] });
  });
  const businessId = newResourceId(), business = RuntimeTaskFactSchema.parse({ id: businessId, projectId, serviceId, name: 'Business task', protocol: 'v3', state: 'closed', createdAt: statisticsWindow.from, closedAt: statisticsWindow.to, traceId: 'shared-trace', attemptsPartial: false,
    attempts: [{ ...facts[0]!.attempts[0]!, id: newResourceId(), taskId: businessId, name: 'Business Agent', executionId: newResourceId(), profileId: newResourceId(), profileName: null, startedAt: statisticsWindow.from, endedAt: statisticsWindow.to }] });
  facts.push(business);
  const admin: Actor = { userId: newResourceId() as Actor['userId'], isAdmin: true }, member: Actor = { ...admin, isAdmin: false };
  const state = { selected: undefined as string[] | undefined, authorized: true, namesAvailable: true, transaction: false };
  const profiles = [...new Map(facts.map((f) => [f.attempts[0]!.profileId!, { id: f.attempts[0]!.profileId!, revision: 7, protocol: 'opencode' as const, name: 'Current renamed Compute', model: 'configured-never-observed' }])).values()];
  const empty = async () => [];
  const reportRoot=mkdtempSync(join(tmpdir(),'cs-development-complete-'));
  const module = createObservabilityModule({ db: tdb.db, reportDataRoot:reportRoot, reportSnapshot:originalReportSnapshotSession(tdb.handle), reportFacts:(tx,q,snapshotId)=>{
    const selected=(kind:string)=>facts.filter(f=>(f.source?.kind??'business-task')===kind&&(!q.projectId||f.projectId===q.projectId)&&(!q.taskId||f.id===q.taskId)&&(!state.selected||q.taskId||state.selected.includes(f.id)));
    const reader=<T,>(items:readonly T[])=>({next:async()=>{state.transaction=tx!==tdb.db;await tx.execute(sql`SELECT 1`);return {items,snapshotId,nextCursor:null};}});
    const headers=(kind:string)=>selected(kind).map(({attempts:_a,attemptsPartial:_p,...header})=>header);
    return {tasks:{'business-task':reader(headers('business-task')),'development-agent':reader(headers('development-agent'))},attempts:(task)=>reader(facts.find(f=>f.id===task.id)?.attempts??[]),projectName:async()=>state.namesAvailable?'Named project':null,profileName:async()=>state.namesAvailable?'Current renamed Compute':null};
  }, clock: fixedClock(statisticsWindow.to), k8s: createFakeK8sClient(), isAdmin: async () => true,
    authorizer: { authorize: async (_actor, p) => { if (!state.authorized || p !== projectId) throw forbidden('outside project'); } }, services: { resolveServiceOfProject: async () => undefined }, slots: { slotRoles: async () => undefined }, pricingProfiles: { list: async () => profiles },
    traces: { environments: { traceKeys: empty, activeTraceIds: empty, list: empty }, deliveries: { traceKeys: empty, activeTraceIds: empty, list: empty }, businessTasks: { list: empty }, sessions: { summarize: empty, events: empty } },

  });
  for (const p of profiles) await module.api.savePrice(admin, p.id, { expectedRevision: 0, requestKey: 'price-'+p.id, profileRevision: 7, protocol: 'opencode', ...statisticsModel, currency: 'CNY', rates: { input: '2', output: '0', cacheRead: '0', cacheWrite: '0' }, effectiveFrom: statisticsWindow.to, sourceNote: 'ACCEPTANCE-ONLY-CNY-NOT-SUPPLIER-BILL: controlled actual model' });
  const feed = async (task: typeof facts[number], input: string, patch: Partial<UsageExecutionIdentity> = {}, priced = true) => {
    const a = task.attempts[0]!, identity = task.source?.kind === 'development-agent' ? { ...task.source.identity, ...patch } : ExecutionObservationIdentitySchema.parse({ projectId: task.projectId, taskId: task.id, subtaskId: a.id, executionId: a.executionId, executionGeneration: a.attempt });
    if (priced) await module.api.acceptExecutionPrice({ identity, profile: { id: a.profileId!, revision: 7, protocol: 'opencode' } });
    const ledger = drizzleUsageLedger(tdb.db), cursor = await ledger.cursor(identity, 'numeric'), next = String(Number(cursor ?? 0)+1);
    const root='native-root-'+identity.executionId, turn='original-turn';
    await module.api.ingestExecutionUsage({ projectId: identity.projectId, taskId: identity.taskId, sourceId: 'numeric', expectedCursor: cursor, nextCursor: next, events: [{ eventId: 'event-'+next, measurement: { kind: 'usage', identity, sourceId: 'numeric', recordId: 'native-step', revision: 1, occurredAt: statisticsWindow.from, observedAt: statisticsWindow.from, adapterVersion: 'controlled-native/1', modelRef: jsonHash(statisticsModel), reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', scope: {root,session:root,parentSession:null,ancestors:[],turn,turnIndex:0,level:'request'}, coveredThroughTurn: null, basis: { kind: 'invocation' }, usage: { input, output: '0', cacheRead: '0', cacheWrite: '0' } } }] });
    const measurement = { identity, sourceId: 'numeric', recordId: 'native-step' }, usage = await drizzleExecutionValuations(tdb.db).usage(measurement);
    if (priced) await module.api.valueExecutionUsage({ measurement, usageRevision: usage!.projection.projectionRevision, requestKey: jsonHash(measurement), model: statisticsModel });
    const capture:NativeCaptureDocument={id:'capture-'+jsonHash(identity),identity,sourceId:'numeric',began:true,baselineRoot:root,historicalRevisionGap:false,proof:{contract:'opencode-child-steps-v1',lineageKey:'lineage-'+identity.executionId,turn,turnIndex:0,state:'complete',root,observedAt:statisticsWindow.to,baseline:{kind:'fresh',fingerprint:null},fingerprint:'fingerprint-'+identity.executionId,sessions:1,steps:1,emitted:1,baselineSteps:0,priorRevisionGap:false,issues:[]}};
    await tdb.db.insert(nativeCaptures).values({id:capture.id,taskKey:jsonHash({projectId:identity.projectId,taskId:identity.taskId}),sourceId:'numeric',turn,lineageKey:capture.proof.lineageKey,root,finalized:true,document:capture,summary:nativeCaptureSummary(capture,{steps:1,baselines:0,unresolved:0,revised:0})});
    await tdb.db.insert(nativeSteps).values({captureId:capture.id,recordId:'native-step',taskKey:jsonHash({projectId:identity.projectId,taskId:identity.taskId}),nativeKey:'native-'+jsonHash(identity),root,revision:1,fingerprint:'step-'+identity.executionId});
    return usage!;
  };
  const settle=async(pending:Promise<RuntimeCompleteReport>,actor:Actor=admin,project:ProjectId|null=null)=>{
    let report=RuntimeCompleteReportSchema.parse(await pending);
    while(report.state==='building')report=RuntimeCompleteReportSchema.parse(await module.api.runtimeCompleteReportStatus(actor,project,report.reportId));
    return report;
  };
  const ready=async(pending:Promise<RuntimeCompleteReport>,actor:Actor=admin,project:ProjectId|null=null)=>{const report=await settle(pending,actor,project);if(report.state!=='ready')throw new Error(JSON.stringify(report));return report;};
  const page=async<T,>(report:Extract<RuntimeCompleteReport,{state:'ready'}>,section:RuntimeReportSection,parent?:string,actor:Actor=admin)=>{
    const items:T[]=[];let after:string|undefined;
    do {const current=await module.api.runtimeCompleteReportPage(actor,report.header.projectId,report.reportId,{section,pageSize:37,...(parent?{parent}:{}),...(after?{after}:{})}) as RuntimeReportPage<T>;items.push(...current.items);after=current.nextCursor??undefined;}while(after);
    return items;
  };
  return { module, facts, projectId, workspaceId, state, admin, member, feed,settle,ready,page,async close(){for(const worker of module.reportWorkers)await worker.stop();rmSync(reportRoot,{recursive:true,force:true});} };
}
