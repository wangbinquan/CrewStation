import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { newResourceId } from '@crewstation/kernel';
import type { BusinessRecoveryClaimReceipt } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { taskRecoveryFixture } from './taskRecoveryFixture';
import { contracts } from '../adapters/persistence/tables';
import { recoveryAudit, recoveryRequests } from '../adapters/persistence/recovery/tables';

const available = await testDatabaseAvailable(), root = '/v3/business-execution/recovery';
describe.skipIf(!available)('RFC029 应用恢复收件 HTTP 边界', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('只读不认领；当前 holder 认领并拒绝，禁止伪报成功及重复认领', async () => {
    const f = await taskRecoveryFixture(tdb.db), saved = await f.repository.request(f.admission);
    const read = `${root}/${saved.id}/read`, before = await tdb.db.select().from(recoveryRequests).where(eq(recoveryRequests.id, saved.id));
    expect(await (await f.request(read, { fence: f.fence })).json()).toEqual(saved);
    expect(await tdb.db.select().from(recoveryRequests).where(eq(recoveryRequests.id, saved.id))).toEqual(before);
    expect((await tdb.db.select().from(recoveryAudit).where(eq(recoveryAudit.requestId, saved.id))).map((r) => r.event)).toEqual(['requested']);
    const claimed = await f.request(`${root}/claim`, { fence: f.fence, requestId: saved.id });
    expect(claimed.status).toBe(200);
    const claim = await claimed.json() as BusinessRecoveryClaimReceipt;
    expect(claim.request).toMatchObject({ id: saved.id, state: 'claimed' });
    expect(await (await f.request(`${root}/claim`, { fence: f.fence })).json()).toBeNull();
    expect((await f.request(`${root}/${saved.id}/reject`, { fence: f.fence, claimId: claim.claimId, reason: '任务已被业务归档' })).status).toBe(200);
    expect(await (await f.make().request(read, { fence: f.fence })).json()).toMatchObject({ state: 'rejected', reason: '任务已被业务归档' });
    expect((await f.request(`${root}/${saved.id}/succeed`, { fence: f.fence })).status).toBe(404);
  });
  test('无来源身份、旧 fence、跨服务请求、非法输入和撤销能力均拒绝', async () => {
    const f = await taskRecoveryFixture(tdb.db), other = await taskRecoveryFixture(tdb.db), saved = await f.repository.request(f.admission);
    const path = `${root}/${saved.id}/read`;
    expect((await f.request(path, { fence: f.fence }, 'invalid')).status).toBe(403);
    expect((await f.request(path, { fence: { ...f.fence, epoch: f.fence.epoch + 1 } })).status).toBe(409);
    expect((await other.request(path, { fence: other.fence })).status).toBe(404);
    expect((await other.request(`${root}/claim`, { fence: other.fence, requestId: saved.id })).status).toBe(200);
    expect((await f.request(`${root}/claim`, { fence: f.fence, requestId: 'not-a-uuid' })).status).toBe(400);
    const claim = await (await f.request(`${root}/claim`, { fence: f.fence })).json() as BusinessRecoveryClaimReceipt;
    expect((await f.request(`${root}/${saved.id}/reject`, { fence: f.fence, claimId: newResourceId(), reason: 'wrong claim' })).status).toBe(409);
    expect((await f.request(`${root}/${saved.id}/reject`, { fence: f.fence, claimId: claim.claimId, reason: '   ' })).status).toBe(400);
    await tdb.db.update(contracts).set({ tasksSpec: sql`tasks_spec - 'recovery'` }).where(eq(contracts.releaseId, f.releaseId));
    expect((await f.request(path, { fence: f.fence })).status).toBe(412);
    expect((await f.request(`${root}/${saved.id}/reject`, { fence: f.fence, claimId: claim.claimId, reason: 'revoked' })).status).toBe(412);
    expect(await f.repository.get(f.serviceId, saved.id)).toMatchObject({ state: 'claimed' });
  });
  test('长期运行请求重新排队后，不持续挡住尚未领取的新恢复请求', async () => {
    const f = await taskRecoveryFixture(tdb.db), saved = await f.repository.request(f.admission);
    const row = (await tdb.db.select().from(recoveryRequests).where(eq(recoveryRequests.id, saved.id)))[0]!;
    // Seed an independently admitted task in the same service; this test exercises queue fairness only.
    const id = newResourceId(), taskId = newResourceId() as typeof f.task.id;
    await tdb.db.insert(recoveryRequests).values({ ...row, id, taskId, requestKey: 'waiting-request', target: { ...row.target, taskId }, createdAt: new Date('2021-01-01'), updatedAt: new Date('2021-01-01') });
    await tdb.db.update(recoveryRequests).set({ state: 'running', leaseUntil: new Date(0), createdAt: new Date('2020-01-01'), updatedAt: new Date() }).where(eq(recoveryRequests.id, saved.id));
    const next = await (await f.request(`${root}/claim`, { fence: f.fence })).json() as BusinessRecoveryClaimReceipt;
    expect(next.request.id).toBe(id);
    expect((await f.repository.get(f.serviceId, saved.id))?.state).toBe('running');
  });
});
