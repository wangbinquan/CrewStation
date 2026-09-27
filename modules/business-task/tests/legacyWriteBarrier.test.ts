import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ReleaseId, RunnerCommand, SubtaskDto, TaskId, TraceId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { drizzleExecutionControls } from '../adapters/persistence/executionControl';
import { drizzleLegacyMutations, legacyMutationsQuiescent } from '../adapters/persistence/legacyMutations';
import { businessTaskMigrations } from '../wiring';
import { executionHttpFixture } from './executionHttpFixture';
import type { ExecutionAuthority } from '../domain/executionControl';

const available = await testDatabaseAvailable();
const source = (): ExecutionAuthority => ({ releaseId: newResourceId() as ReleaseId, physicalSlot: 'blue', role: 'prod', podUid: newResourceId(), ready: true });
describe.skipIf(!available)('RFC-027 legacy writes cannot race first execution-control claim', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([eventbusMigrations, businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });

  test('durable admission and first claim serialize; requests already in flight must settle', async () => {
    const serviceId = newResourceId(), barrier = drizzleLegacyMutations(tdb.db), controls = drizzleExecutionControls(tdb.db);
    const ticket = await barrier.begin({ serviceId, kind: 'create-environment' });
    await expect(controls.claim(serviceId, source(), { instanceId: newResourceId() })).rejects.toMatchObject({ details: { code: 'legacy_dispatch_in_flight' } });
    expect((await controls.read(serviceId)).control).toBeUndefined();
    await barrier.settle(ticket, 'complete');
    expect((await controls.claim(serviceId, source(), { instanceId: newResourceId() })).control?.phase).toBe('preparing');
    await expect(barrier.begin({ serviceId, kind: 'late-write' })).rejects.toMatchObject({ details: { code: 'execution_fence_required' } });
  });

  test('racing admission and control can never both win', async () => {
    const barrier = drizzleLegacyMutations(tdb.db), controls = drizzleExecutionControls(tdb.db);
    for (let i = 0; i < 8; i++) {
      const serviceId = newResourceId();
      const outcomes = await Promise.allSettled([
        barrier.begin({ serviceId, kind: 'legacy-request' }),
        controls.claim(serviceId, source(), { instanceId: newResourceId() }),
      ]);
      expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    }
  });

  test('process loss and unknown remote receipt survive module reconstruction; a late completion cannot clear unknown', async () => {
    const serviceId = newResourceId(), barrier = drizzleLegacyMutations(tdb.db);
    const lost = await barrier.begin({ serviceId, kind: 'runner:exec', taskId: newResourceId() });
    await barrier.settle(lost, 'unknown');
    await drizzleLegacyMutations(tdb.db).settle(lost, 'complete');
    expect(await legacyMutationsQuiescent(tdb.db, serviceId)).toBe(false);
    await expect(drizzleExecutionControls(tdb.db).claim(serviceId, source(), { instanceId: newResourceId() })).rejects.toMatchObject({ details: { code: 'legacy_dispatch_in_flight' } });
    const crashedService = newResourceId();
    await barrier.begin({ serviceId: crashedService, kind: 'request' });
    expect(await legacyMutationsQuiescent(tdb.db, crashedService)).toBe(false);
  });

  test('all v2 write routes reject an established control before touching runtime; read routes remain available', async () => {
    const f = await executionHttpFixture(tdb.db), taskId = newResourceId(), subtaskId = newResourceId();
    expect((await f.request('/v3/business-execution/control/claim', { instanceId: newResourceId() })).status).toBe(200);
    const root = `/v2/business-tasks/${taskId}`, commands: RunnerCommand[] = [];
    f.runner.sendCommand = async (_, command) => { commands.push(command); throw new Error('not dispatched'); };
    const writes: Array<[string, unknown]> = [
      ['/v2/business-tasks', {}], [`${root}/close`, {}], [`${root}/pause`, {}], [`${root}/resume`, {}],
      [`${root}/subtasks`, { kind: 'command', name: 'check', command: ['true'] }],
      [`${root}/subtasks/${subtaskId}/messages`, { content: 'continue' }],
      [`${root}/subtasks/${subtaskId}/cancel`, {}], [`${root}/subtasks/${subtaskId}/retry`, {}],
    ];
    for (const [path, input] of writes) {
      const response = await f.request(path, input);
      expect(response.status).toBe(412); expect(await response.json()).toMatchObject({ details: { code: 'execution_fence_required' } });
    }
    expect((await f.request(root)).status).toBe(404); expect(f.behavior.starts).toBe(0); expect(commands).toHaveLength(0);
    expect(await legacyMutationsQuiescent(tdb.db, f.serviceId)).toBe(true);
  });

  test('detached old exec keeps its own ticket beyond the HTTP response and blocks first claim', async () => {
    const f = await executionHttpFixture(tdb.db);
    // Seed a pre-upgrade v2 task so the fixture does not need a v3 admission to exercise old dispatch.
    const { drizzleTaskRepository } = await import('../adapters/persistence/drizzleRepositories');
    const taskId = newResourceId() as TaskId;
    await drizzleTaskRepository(tdb.db).insert({ id: taskId, serviceId: f.serviceId, projectId: f.projectId, callerIdentity: 'demo/demo', state: 'running',
      traceId: 'a'.repeat(32) as TraceId, volumeMode: 'persistent', profile: f.taskProfileId, labels: {}, createdAt: new Date(), updatedAt: new Date() });
    f.environments.set(taskId, { id: taskId, projectId: f.projectId, state: 'running', connected: true, traceId: 'a'.repeat(32), podName: 'old', profile: f.taskProfileId });
    const started = Promise.withResolvers<void>(), result = Promise.withResolvers<unknown>();
    f.runner.sendCommand = async () => { started.resolve(); return result.promise; };
    const response = await f.request(`/v2/business-tasks/${taskId}/subtasks`, { kind: 'command', name: 'long', command: ['sleep', '90'] });
    expect(response.status).toBe(201); const subtask = await response.json() as SubtaskDto; await started.promise;
    expect(await legacyMutationsQuiescent(tdb.db, f.serviceId)).toBe(false);
    expect((await f.request('/v3/business-execution/control/claim', { instanceId: newResourceId() })).status).toBe(412);
    result.resolve({ execId: 'old', exitCode: 0, stdout: 'done', stderr: '', truncated: false });
    // Wait on the particular durable effect receipt, not a guessed process delay.
    const deadline = Date.now() + 2000;
    while (!(await legacyMutationsQuiescent(tdb.db, f.serviceId))) { if (Date.now() >= deadline) throw new Error('receipt did not settle'); await Bun.sleep(10); }
    expect((await f.request('/v3/business-execution/control/claim', { instanceId: newResourceId() })).status).toBe(200);
    for (;;) {
      const latest = await (await f.request(`/v2/business-tasks/${taskId}/subtasks/${subtask.id}`)).json() as SubtaskDto;
      if (latest.state === 'succeeded') break;
      if (Date.now() >= deadline) throw new Error('detached completion did not finish');
      await Bun.sleep(10);
    }
  });

  test('control claimed while a legacy command waits for its Runner leaves it pending, without starting or failing it', async () => {
    const f = await executionHttpFixture(tdb.db), { drizzleTaskRepository } = await import('../adapters/persistence/drizzleRepositories');
    const taskId = newResourceId() as TaskId;
    await drizzleTaskRepository(tdb.db).insert({ id: taskId, serviceId: f.serviceId, projectId: f.projectId, callerIdentity: 'demo/demo', state: 'creating',
      traceId: 'a'.repeat(32) as TraceId, volumeMode: 'persistent', profile: f.taskProfileId, labels: {}, createdAt: new Date(), updatedAt: new Date() });
    const env = { id: taskId, projectId: f.projectId, state: 'creating' as const, connected: false, traceId: 'a'.repeat(32), podName: 'old', profile: f.taskProfileId };
    f.environments.set(taskId, env);
    const response = await f.request(`/v2/business-tasks/${taskId}/subtasks`, { kind: 'command', name: 'pending', command: ['true'] });
    const subtask = await response.json() as SubtaskDto; expect(subtask.state).toBe('pending');
    expect((await f.request('/v3/business-execution/control/claim', { instanceId: newResourceId() })).status).toBe(200);
    env.connected = true; let sent = 0;
    f.runner.sendCommand = async () => { sent++; throw new Error('must not start'); };
    expect(await f.module.api.dispatchPendingSubtasks(taskId)).toBe(0);
    expect(await f.module.api.sweepActive()).toBe(0);
    expect(await (await f.request(`/v2/business-tasks/${taskId}/subtasks/${subtask.id}`)).json()).toMatchObject({ state: 'pending' });
    expect(sent).toBe(0);
  });
});
