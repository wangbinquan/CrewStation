import { afterEach,describe,expect,test } from 'bun:test';
import { createTestDatabase,testDatabaseAvailable,type TestDatabase } from '../../packages/testkit';
import { devSessionMigrations } from '../../modules/dev-session';
import { sessionMigrations } from '../../modules/session';
import { observabilityMigrations } from '../../modules/observability';
import type {CompleteRuntimeTaskSummary,CompleteRuntimeAttemptSummary,CompleteRuntimeProject,CompleteRuntimeProfile} from '../../packages/contracts';
import { developmentStatisticsChain,developmentStatisticsWindow as window } from './developmentStatisticsFixture';
const available=await testDatabaseAvailable();let tdb:TestDatabase,chain:Awaited<ReturnType<typeof developmentStatisticsChain>>;
afterEach(async()=>{await chain?.cleanup();await tdb?.drop();});
async function fixture(){tdb=await createTestDatabase([devSessionMigrations,sessionMigrations,observabilityMigrations]);chain=await developmentStatisticsChain(tdb);return chain;}
describe.skipIf(!available)('cross-owner development numeric consumption and statistics',()=>{
  test('actual SQLite -> Session PG -> ledger preserves one original execution, exact CNY and safe project facts',async()=>{
    const f=await fixture();await f.copy();expect(await f.observations.api.reconcileExecutionUsage()).toBe(1);
    const stats=await f.settle(f.observations.api.systemRuntimeStatistics(f.admin,window),null),tasks=await f.page<CompleteRuntimeTaskSummary>(stats,'tasks');expect(tasks).toHaveLength(1);expect(stats.summary.tasks).toBe('1');expect(stats.summary.metrics).toMatchObject({state:'ready',tokens:{input:'9007199254740993',cacheRead:'0',cacheWrite:'0',output:'7',total:'9007199254741000'},cost:{state:'complete',amount:'18014398509.481986'}});
    expect((await f.page<CompleteRuntimeProject>(stats,'projects'))[0]?.projectName).toBe('Actual owner project');expect((await f.page<CompleteRuntimeProfile>(stats,'profiles'))[0]?.profileName).toBe('Original accepted Compute');expect(stats.summary.sources[1]?.collectionState).toBe('production-disabled');expect(stats.summary.durations).toMatchObject({state:'complete',samples:'0'});
    const task=await f.settle(f.observations.api.systemRuntimeTask(f.admin,f.f.child.id),null),row=(await f.page<CompleteRuntimeTaskSummary>(task,'tasks'))[0]!;expect(row.source).toMatchObject({kind:'development-agent',identity:f.registration.identity});expect((await f.page<CompleteRuntimeAttemptSummary>(task,'attempts',row.id))[0]?.durationMs).toBeNull();expect(row.timing.wallMs).toBeNull();
    const project=await f.settle(f.observations.api.projectRuntimeStatistics(f.admin,f.f.workspace.projectId,window));expect(project.summary.metrics).toMatchObject({state:'ready',cost:{state:'hidden',amount:null}});expect((await f.page<CompleteRuntimeTaskSummary>(project,'tasks'))[0]?.metrics).toMatchObject({state:'ready',tokens:{total:'9007199254741000'}});

    for(const secret of ['owner-private-prompt','digestNonce','payloadDigest','configured-never-observed','binaryPath'])expect(JSON.stringify(stats)).not.toContain(secret);
    expect(await f.session.api.nextDevelopmentUsageSource()).toBeUndefined();
  });
  test('consumer ACK loss, restart and current price change cannot add usage or overwrite accepted compute',async()=>{
    const f=await fixture();await f.copy();f.controls.lostAck=true;expect(await f.observations.api.reconcileExecutionUsage()).toBe(0);const before=await f.fingerprint();
    f.reopen();expect(await f.observations.api.reconcileExecutionUsage()).toBe(0);expect(await f.fingerprint()).toBe(before);
    await f.observations.api.savePrice(f.admin,f.profile.id,{expectedRevision:1,requestKey:'new-current-CNY-price',profileRevision:2,protocol:'opencode',provider:'actual-provider',model:'controlled-M',condition:null,currency:'CNY',rates:{input:'999',output:'0',cacheRead:'0',cacheWrite:'0'},effectiveFrom:window.to,sourceNote:'later catalogue'});
    expect(await f.fingerprint()).toBe(before);f.controls.namesAvailable=false;const detail=await f.settle(f.observations.api.systemRuntimeTask(f.admin,f.f.child.id),null);expect((await f.page<CompleteRuntimeAttemptSummary>(detail,'attempts',f.f.child.id))[0]?.profileName).toBe('Original accepted Compute');
  });
  test('development-only worker starts and a failing business participant does not starve it',async()=>{
    const f=await fixture();await f.copy();expect(f.observations.workers).toHaveLength(2);f.reopen(true);expect(await f.observations.api.reconcileExecutionUsage()).toBe(1);expect(f.controls.businessReads).toBeGreaterThan(0);expect(f.controls.developmentReads).toBeGreaterThan(0);
    const before=f.controls.developmentReads,worker=f.observations.workers[0]!;worker.start();await worker.stop();expect(f.controls.developmentReads).toBeGreaterThan(before);
  });
});
