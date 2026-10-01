import { afterEach,describe,expect,test } from 'bun:test';
import { createTestDatabase,testDatabaseAvailable,type TestDatabase } from '../../packages/testkit';
import { devSessionMigrations } from '../../modules/dev-session';
import { sessionMigrations } from '../../modules/session';
import { observabilityMigrations } from '../../modules/observability';
import { developmentStatisticsChain,developmentStatisticsWindow as window } from './developmentStatisticsFixture';
const available=await testDatabaseAvailable();let tdb:TestDatabase,chain:Awaited<ReturnType<typeof developmentStatisticsChain>>;
afterEach(async()=>{await chain?.cleanup();await tdb?.drop();});
async function fixture(){tdb=await createTestDatabase([devSessionMigrations,sessionMigrations,observabilityMigrations]);chain=await developmentStatisticsChain(tdb);return chain;}
describe.skipIf(!available)('cross-owner development numeric consumption and statistics',()=>{
  test('actual SQLite -> Session PG -> ledger preserves one original execution, exact CNY and safe project facts',async()=>{
    const f=await fixture();await f.copy();expect(await f.observations.api.reconcileExecutionUsage()).toBe(1);
    const stats=await f.observations.api.systemRuntimeStatistics(f.admin,window);expect(stats.tasks).toHaveLength(1);expect(stats.metrics.tokens.total).toBe('9007199254741000');expect(stats.metrics.cost.amount).toBe('18014398509.481986');
    expect(stats.projects[0]?.projectName).toBe('Actual owner project');expect(stats.profiles[0]?.profileName).toBe('Original accepted Compute');expect(stats.sources?.[1]?.collectionState).toBe('production-disabled');expect(stats.durations.samples).toBe(0);
    const task=await f.observations.api.systemRuntimeTask(f.admin,f.f.child.id);expect(task.source).toMatchObject({kind:'development-agent',identity:f.registration.identity});expect(task.attempts[0]?.durationMs).toBeNull();expect(task.wallMs).toBeNull();
    const project=await f.observations.api.projectRuntimeStatistics(f.admin,f.f.workspace.projectId,window);expect(project.metrics.cost).toMatchObject({visible:false,amount:null});expect(project.tasks[0]?.metrics.tokens.total).toBe('9007199254741000');
    for(const secret of ['owner-private-prompt','digestNonce','payloadDigest','configured-never-observed','binaryPath'])expect(JSON.stringify(stats)).not.toContain(secret);
    expect(await f.session.api.nextDevelopmentUsageSource()).toBeUndefined();
  });
  test('consumer ACK loss, restart and current price change cannot add usage or overwrite accepted compute',async()=>{
    const f=await fixture();await f.copy();f.controls.lostAck=true;expect(await f.observations.api.reconcileExecutionUsage()).toBe(0);const before=await f.fingerprint();
    f.reopen();expect(await f.observations.api.reconcileExecutionUsage()).toBe(0);expect(await f.fingerprint()).toBe(before);
    await f.observations.api.savePrice(f.admin,f.profile.id,{expectedRevision:1,requestKey:'new-current-CNY-price',profileRevision:2,protocol:'opencode',provider:'actual-provider',model:'controlled-M',condition:null,currency:'CNY',rates:{input:'999',output:'0',cacheRead:'0',cacheWrite:'0'},effectiveFrom:window.to,sourceNote:'later catalogue'});
    expect(await f.fingerprint()).toBe(before);f.controls.namesAvailable=false;expect((await f.observations.api.systemRuntimeTask(f.admin,f.f.child.id)).attempts[0]?.profileName).toBe('Original accepted Compute');
  });
  test('development-only worker starts and a failing business participant does not starve it',async()=>{
    const f=await fixture();await f.copy();expect(f.observations.workers).toHaveLength(2);f.reopen(true);expect(await f.observations.api.reconcileExecutionUsage()).toBe(1);expect(f.controls.businessReads).toBeGreaterThan(0);expect(f.controls.developmentReads).toBeGreaterThan(0);
    const before=f.controls.developmentReads,worker=f.observations.workers[0]!;worker.start();await worker.stop();expect(f.controls.developmentReads).toBeGreaterThan(before);
  });
});
