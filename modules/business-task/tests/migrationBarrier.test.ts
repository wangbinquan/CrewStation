import { afterEach, describe, expect, test } from 'bun:test';
import type { BusinessControlDto, BusinessSubtaskV3Dto, ReleaseId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 migration write barrier', () => {
  let db: TestDatabase;
  afterEach(async () => { await db?.drop(); });
  test('freezes execution first, requires authenticated application receipt and all runtime writers stopped; survives restart', async () => {
    db = await createTestDatabase([businessTaskMigrations]); const f = await executionCommandFixture(db.db);
    const input = { operationId: newResourceId(), expectedActiveReleaseId: f.releaseId, targetReleaseId: newResourceId() as ReleaseId };
    const first = await f.module.api.releaseHandoff.migrationBarrier(f.serviceId, input);
    expect(first).toMatchObject({ ready: false, blocked: expect.arrayContaining(['application_write_barrier_missing', f.task.id]) });
    expect(first.epoch).toBeGreaterThan(f.fence.epoch);
    expect((await f.request(f.path, f.input)).status).toBe(409);
    const root = '/v3/business-execution/control', receipt = { operationId: input.operationId, expectedEpoch: first.epoch, preparationDigest: 'b'.repeat(64) };
    expect((await f.request(`${root}/claim`, { instanceId: newResourceId() })).status).toBe(412);
    expect((await f.request(`${root}/migrations/${input.operationId}/ready`, { ...receipt, expectedEpoch: first.epoch - 1 })).status).toBe(409);
    f.sources.set('preview', { ...f.sources.get('trusted')!, slot: 'preview', source: { ...f.sources.get('trusted')!.source, physicalSlot: 'green', podUid: 'other' } });
    expect((await f.request(`${root}/migrations/${input.operationId}/ready`, receipt, 'preview')).status).toBe(403);
    expect((await f.request(`${root}/migrations/${input.operationId}/ready`, receipt)).status).toBe(200);
    const restarted = f.make();
    expect(await restarted.module.api.releaseHandoff.migrationBarrier(f.serviceId, input)).toMatchObject({ ready: false, epoch: first.epoch, blocked: [f.task.id] });
    f.env.state = 'paused'; f.env.connected = false;
    expect(await restarted.module.api.releaseHandoff.migrationBarrier(f.serviceId, input)).toMatchObject({ ready: true, epoch: first.epoch, preparationDigest: receipt.preparationDigest });
    const dto = await (await restarted.request(root)).json() as BusinessControlDto;
    expect(dto.migration).toEqual({ operationId: input.operationId, targetReleaseId: input.targetReleaseId, applicationReady: true });
    expect(dto.phase).toBe('frozen');
    f.environments.delete(f.task.id);
    expect((await restarted.module.api.releaseHandoff.migrationBarrier(f.serviceId, input)).ready).toBe(false);
    expect((await f.request(`${root}/migrations/${input.operationId}/ready`, { ...receipt, preparationDigest: 'c'.repeat(64) })).status).toBe(409);
    f.environments.set(f.task.id, f.env);
    const replacement = { ...input, operationId: newResourceId(), targetReleaseId: newResourceId() as ReleaseId };
    await expect(restarted.module.api.releaseHandoff.migrationBarrier(f.serviceId, replacement)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(restarted.module.api.releaseHandoff.migrationBarrier(f.serviceId, { ...replacement, supersedesOperationId: 'stale-operation' })).rejects.toMatchObject({ kind: 'precondition' });
    const recovered = await restarted.module.api.releaseHandoff.migrationBarrier(f.serviceId, { ...replacement, supersedesOperationId: input.operationId });
    expect(recovered).toMatchObject({ ready: true, preparationDigest: receipt.preparationDigest });
    expect(recovered.epoch).toBeGreaterThan(first.epoch);
    expect((await f.request(`${root}/claim`, { instanceId: newResourceId() })).status).toBe(412);
    expect((await f.request(`${root}/migrations/${input.operationId}/ready`, receipt)).status).toBe(409);
    expect((await restarted.module.api.releaseHandoff.inspect(f.serviceId)).migration?.operationId).toBe(replacement.operationId);

  });
  test('frozen migration grants only explicit cancellation and pause/close, never resume or new work', async () => {
    db = await createTestDatabase([businessTaskMigrations]); const f = await executionCommandFixture(db.db);
    const child = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    const migration = { operationId: newResourceId(), expectedActiveReleaseId: f.releaseId, targetReleaseId: newResourceId() as ReleaseId };
    const frozen = await f.module.api.releaseHandoff.migrationBarrier(f.serviceId, migration);
    const stopAuthority = { operationId: migration.operationId, epoch: frozen.epoch }, root = `/v3/business-tasks/${f.task.id}`;
    const stop = { requestKey: 'stop-child', expectedAttempt: 1, stopAuthority };
    expect((await f.request(`${f.path}/${child.id}/cancel`, { ...stop, stopAuthority: { ...stopAuthority, epoch: frozen.epoch - 1 } })).status).toBe(409);
    f.sources.set('preview', { ...f.sources.get('trusted')!, slot: 'preview' });
    expect((await f.request(`${f.path}/${child.id}/cancel`, stop, 'preview')).status).toBe(403);
    expect((await f.request(`${f.path}/${child.id}/cancel`, stop)).status).toBe(202);
    expect((await f.request(`${root}/pause`, { requestKey: 'pause', expectedGeneration: 1, stopAuthority })).status).toBe(409);
    const { drizzleExecutionProjection } = await import('../adapters/persistence/execution/projection');
    const { drizzleExecutionSubtasks } = await import('../adapters/persistence/execution/subtasks');
    const projection = drizzleExecutionProjection(db.db), subtask = (await drizzleExecutionSubtasks(db.db).get(f.serviceId, f.task.id, child.id))!;
    const receipt = f.receipts.get(child.executionId)!; expect(receipt.phase).toBe('finished');
    await projection.pending(20);
    const occurredAt = new Date().toISOString();
    await projection.append(subtask, { taskId: f.task.id, receipt, persistedThrough: 2, acknowledgedThrough: 2, complete: true }, [
      { sequence: 1, occurredAt, frame: { type: 'state', state: 'running' } },
      { sequence: 2, occurredAt, frame: { type: 'result', result: receipt.result! } },
    ]);
    f.environmentPort.pauseEnvironment = async () => { f.env.state = 'paused'; f.env.connected = false; return f.env; };
    expect(await (await f.request(`${root}/pause`, { requestKey: 'pause', expectedGeneration: 1, stopAuthority })).json()).toMatchObject({ state: 'succeeded' });
    expect((await f.request(`${root}/resume`, { requestKey: 'no-resume', expectedGeneration: 2, stopAuthority })).status).toBe(412);
    expect((await f.request(f.path, { ...f.input, stopAuthority, fence: undefined, requestKey: 'no-spawn' })).status).toBe(400);
    expect((await f.module.api.releaseHandoff.migrationBarrier(f.serviceId, migration)).blocked).toEqual(['application_write_barrier_missing']);
  });

});
