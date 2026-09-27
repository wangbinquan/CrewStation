import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import type { BusinessSubtaskV3Dto, BusinessControlDto, ReleaseId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { drizzleExecutionSubtasks } from '../adapters/persistence/execution/subtasks';
import { executionSubtasks } from '../adapters/persistence/execution/subtaskTables';
import { drizzleExecutionControls } from '../adapters/persistence/executionControl';
import { executionCommandFixture } from './executionCommandFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 command durable admission and replay', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  const active = () => executionCommandFixture(tdb.db);

  test('concurrent identical requests dispatch one fixed ID; encrypted material and read-only replay survive reconstruction', async () => {
    const f = await active();
    const responses = await Promise.all(Array.from({ length: 8 }, () => f.request(f.path, f.input)));
    expect(responses.every((r) => [200, 201].includes(r.status))).toBe(true);
    const views = await Promise.all(responses.map((r) => r.json() as Promise<BusinessSubtaskV3Dto>));
    expect(new Set(views.map((v) => v.id)).size).toBe(1); expect(f.behavior.starts).toBe(1);
    const view = views[0]!, stored = (await drizzleExecutionSubtasks(tdb.db).get(f.serviceId, f.task.id, view.id))!;
    expect(JSON.stringify(stored)).not.toContain('secret-not-for-storage'); expect(stored.sealedPayload.startsWith('v1:')).toBe(true);
    expect(stored.view).toMatchObject({ state: 'running', process: 'live' });
    const next = f.make(), before = f.commands.length;
    expect((await next.request(f.path, { ...f.input, fence: undefined })).status).toBe(200);
    expect((await next.request(`${f.path}/${view.id}`)).status).toBe(200);
    expect((await next.request(f.path)).status).toBe(200);
    expect(f.commands.length).toBe(before);
    expect((await next.request(f.path, { ...f.input, argv: ['false'] })).status).toBe(409);
    const other = await active(); expect((await other.request(`${f.path}/${view.id}`)).status).toBe(404);
  });

  test('lost start reply returns unknown handle; rebuilt worker reconciles receipt without another start', async () => {
    const f = await active(); f.behavior.loseReply = true;
    const response = await f.request(f.path, f.input); expect(response.status).toBe(201);
    const view = await response.json() as BusinessSubtaskV3Dto; expect(view.process).toBe('unknown'); expect(f.behavior.starts).toBe(1);
    expect((await f.request(`${f.path}/${view.id}`)).status).toBe(200); expect(f.behavior.starts).toBe(1);
    f.behavior.loseReply = false;
    await f.make().module.api.v3.runOnce();
    expect((await (await f.request(`${f.path}/${view.id}`)).json()).process).toBe('live'); expect(f.behavior.starts).toBe(1);
  });

  test('missing record after Runner replacement cannot silently repeat a side effect', async () => {
    const f = await active(); f.behavior.loseReply = true;
    const view = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    f.receipts.clear(); f.behavior.incarnation = newResourceId(); f.behavior.loseReply = false;
    await f.make().module.api.v3.runOnce();
    expect(f.behavior.starts).toBe(1);
    expect(await (await f.request(`${f.path}/${view.id}`)).json()).toMatchObject({ process: 'unknown', error: { code: 'execution_incarnation_changed' } });
    const frozen = await drizzleExecutionControls(tdb.db).freeze(f.serviceId, { operationId: newResourceId(), expectedActiveReleaseId: f.releaseId, targetReleaseId: newResourceId() as ReleaseId, targetSlot: 'green' });
    expect(frozen.quiescent).toBe(false);
  });

  test('expired pre-start claim under freeze drains to pending without spawn; stale completion cannot overwrite', async () => {
    const f = await active(); f.behavior.disconnectAfterInfo = true;
    const view = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto, store = drizzleExecutionSubtasks(tdb.db);
    const claim = (await store.claim(newResourceId(), view.id))!; expect(claim.incarnation).toBeNull();
    await tdb.db.update(executionSubtasks).set({ leaseUntil: sql`clock_timestamp() - interval '1 second'` }).where(eq(executionSubtasks.id, view.id));
    await drizzleExecutionControls(tdb.db).freeze(f.serviceId, { operationId: newResourceId(), expectedActiveReleaseId: f.releaseId, targetReleaseId: newResourceId() as ReleaseId, targetSlot: 'green' });
    expect(await store.claim(newResourceId(), view.id)).toBeUndefined();
    expect((await store.get(f.serviceId, f.task.id, view.id))?.dispatch).toBe('pending');
    expect(await store.checkpoint(claim, newResourceId())).toBe(false);
    expect(await store.settle(claim, { dispatch: 'accepted', view: { ...view, state: 'running' } })).toBe(false);
    expect(f.behavior.starts).toBe(0);
  });

  test('new holder explicitly adopts unstarted pending intent under the same request key and execution ID', async () => {
    const f = await active(); f.behavior.disconnectAfterInfo = true;
    const original = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    f.behavior.disconnectAfterInfo = false; f.env.connected = true;
    const root = '/v3/business-execution/control';
    expect((await f.request(`${root}/release`, { expectedEpoch: f.fence.epoch, leaseId: f.fence.leaseId, instanceId: f.fence.instanceId })).status).toBe(200);
    const instanceId = newResourceId(), lease = await (await f.request(`${root}/claim`, { instanceId })).json() as BusinessControlDto;
    const fence = { epoch: lease.epoch, leaseId: lease.leaseId!, instanceId };
    expect((await f.request(`${root}/activate`, { expectedEpoch: lease.epoch, leaseId: lease.leaseId, instanceId, preparationDigest: 'b'.repeat(64) })).status).toBe(200);
    await f.make().module.api.v3.runOnce(); expect(f.behavior.starts).toBe(0);
    expect((await drizzleExecutionSubtasks(tdb.db).get(f.serviceId, f.task.id, original.id))?.epoch).toBe(f.fence.epoch);
    expect((await f.request(f.path, f.input)).status).toBe(409);
    const adopted = await (await f.request(f.path, { ...f.input, fence })).json() as BusinessSubtaskV3Dto;
    expect(adopted.id).toBe(original.id); expect(adopted.executionId).toBe(original.executionId);
    for (let i = 0; i < 6 && f.behavior.starts === 0; i++) await f.make().module.api.v3.runOnce();
    expect(f.behavior.starts).toBe(1);
  });

  test('fence, paused state, unregistered Agent profiles and malformed params fail without command dispatch', async () => {
    const f = await active();
    expect((await f.request(f.path, { ...f.input, fence: undefined })).status).toBe(409);
    expect((await f.request(f.path, { ...f.input, extra: true })).status).toBe(400);
    expect((await f.request(f.path, { ...f.input, env: { CS_DATABASE_URL: 'x' } })).status).toBe(400);
    f.env.state = 'paused'; expect((await f.request(f.path, f.input)).status).toBe(409); f.env.state = 'running';
    expect((await f.request(f.path, { kind: 'agent', requestKey: 'agent', name: 'agent', prompt: 'hi', agentProfileId: newResourceId(), fence: f.fence })).status).toBe(400);
    expect(f.commands.filter((c) => c.type !== 'businessExecutionInfo')).toHaveLength(0); expect(f.behavior.starts).toBe(0);
    f.behavior.notSupported = true;
    const response = await f.request(f.path, f.input);
    expect(response.status).toBe(412); expect(await response.json()).toMatchObject({ details: { code: 'unsupported_capability' } });
    expect(await drizzleExecutionSubtasks(tdb.db).find(f.serviceId, f.task.id, f.input.requestKey)).toBeUndefined();
    expect(f.behavior.starts).toBe(0);
  });
});
