import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { ProjectId, ReleaseId, ServiceId, TaskId, TraceId } from '@crewstation/contracts';
import { jsonHash, newResourceId, quotaExceeded, validation } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { drizzleExecutionOperations } from '../adapters/persistence/executionOperations';
import { dispatchTaskAdmission } from '../application/taskAdmissionDispatch';
import type { ExecutionOperation, OperationCandidate, OperationLease } from '../domain/taskAdmission';
import type { EnvironmentView } from '../ports/runtime';
import { businessTaskMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const serviceId = newResourceId() as ServiceId, projectId = newResourceId() as ProjectId;
function candidate(requestKey = newResourceId()): OperationCandidate {
  const taskId = newResourceId() as TaskId, profile = newResourceId(), releaseId = newResourceId() as ReleaseId;
  const intent: OperationCandidate['intent'] = {
    kind: 'create-task', projectId, callerIdentity: 'example/worker', environmentLabels: { 'crewstation.io/project': 'example' },
    tasksSpec: { taskProfileId: profile, defaultVolumeMode: 'persistent', agentProfiles: [], outputContracts: [] },
    task: { id: taskId, serviceId, state: 'admitting', releaseId, taskContractVersion: 'v1', contractDigest: 'a'.repeat(64), generation: 1,
      volumeMode: 'persistent', volumeUid: null, taskProfileId: profile, traceId: '0123456789abcdef0123456789abcdef' as TraceId, labels: {},
      resourceState: 'admitting', quotaHeld: false, createdAt: new Date().toISOString() },
  };
  return { id: newResourceId(), serviceId, kind: 'create-task', parentId: '', requestKey, requestDigest: jsonHash({ volumeMode: 'persistent' }), effectiveDigest: jsonHash(intent), intent, epoch: null };
}
const leaseOf = (op: ExecutionOperation): OperationLease => ({ id: op.id, owner: op.lease!.owner, revision: op.revision });

describe.skipIf(!available)('RFC-027 持久执行意图与 outbox', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });

  test('同键并发只有一个意图，跨模块重启和 release 默认变化仍读取首次快照', async () => {
    const key = newResourceId(), requests = Array.from({ length: 12 }, () => candidate(key));
    const ops = drizzleExecutionOperations(tdb.db);
    const results = await Promise.all(requests.map((input) => ops.reserve(input)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    for (const result of results) expect(result.operation).toEqual(results[0]!.operation);
    const original = results[0]!.operation;
    const replay = await drizzleExecutionOperations(tdb.db).reserve(candidate(key));
    expect(replay).toEqual({ operation: original, created: false });
    await expect(ops.reserve({ ...candidate(key), requestDigest: 'b'.repeat(64) })).rejects.toMatchObject({ kind: 'conflict', details: { code: 'idempotency_conflict' } });
    expect((await ops.find(original))?.intent).toEqual(original.intent);
    expect((await ops.reserve({ ...candidate(key), serviceId: newResourceId() })).created).toBe(true);
  });

  test('多 worker 不会同时认领；过期后只接管原 ID，旧 worker 无法续租或写回', async () => {
    const ops = drizzleExecutionOperations(tdb.db), input = candidate(); await ops.reserve(input);
    const claims = await Promise.all(Array.from({ length: 12 }, (_, n) => ops.claim({ id: input.id, owner: `worker-${n}`, leaseSeconds: 30 })));
    const claimed = claims.filter((value) => value !== undefined);
    expect(claimed).toHaveLength(1);
    const first = claimed[0]!;
    expect(first.attempts).toBe(1);
    expect(await ops.renew(leaseOf(first), 60)).toBe(true);
    await tdb.db.execute(sql`UPDATE business_task.execution_operations SET lease_until = clock_timestamp() - interval '1 second' WHERE id = ${input.id}`);
    expect(await ops.renew(leaseOf(first), 60)).toBe(false);
    expect(await ops.settle(leaseOf(first), 'succeeded')).toBe(false);
    const second = (await drizzleExecutionOperations(tdb.db).claim({ id: input.id, owner: 'new-process', leaseSeconds: 30 }))!;
    expect(second.intent).toEqual(first.intent);
    expect(second.revision).toBe(first.revision + 1);
    expect(second.attempts).toBe(2);
    expect(await ops.settle(leaseOf(first), 'failed')).toBe(false);
    expect(await ops.settle(leaseOf(second), 'succeeded')).toBe(true);
    expect(await ops.claim({ id: input.id, owner: 'third', leaseSeconds: 30 })).toBeUndefined();
  });

  test('429 不在后台等容量，只能同键显式重试；终态键和失败键不复活', async () => {
    const ops = drizzleExecutionOperations(tdb.db), input = candidate(); await ops.reserve(input);
    const claimed = (await ops.claim({ id: input.id, owner: 'worker', leaseSeconds: 30 }))!;
    expect(await ops.settle(leaseOf(claimed), 'retryable-rejected', 'quota_exceeded')).toBe(true);
    expect(await ops.claim({ id: input.id, owner: 'worker', leaseSeconds: 30 })).toBeUndefined();
    await expect(ops.retryRejected(input, 'x')).rejects.toMatchObject({ kind: 'conflict' });
    const retried = await ops.retryRejected(input, input.requestDigest);
    expect(retried.id).toBe(input.id); expect(retried.intent).toEqual(input.intent); expect(retried.state).toBe('pending');
    const next = (await ops.claim({ id: input.id, owner: 'worker', leaseSeconds: 30 }))!;
    await ops.settle(leaseOf(next), 'failed', 'precondition');
    expect((await ops.retryRejected(input, input.requestDigest)).state).toBe('failed');
    expect((await ops.reserve(candidate(input.requestKey))).operation.state).toBe('failed');
    await expect(ops.retryRejected(candidate(), input.requestDigest)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(ops.claim({ owner: 'worker', leaseSeconds: 0 })).rejects.toMatchObject({ kind: 'validation' });
  });

  test('准入成功但回执丢失时查询原任务，不再返回 429，也不更换 ID', async () => {
    const ops = drizzleExecutionOperations(tdb.db), input = candidate(); await ops.reserve(input);
    const claimed = (await ops.claim({ id: input.id, owner: 'worker', leaseSeconds: 30 }))!;
    let environment: EnvironmentView | undefined;
    await dispatchTaskAdmission({ operations: ops, environments: {
      createEnvironment: async (request) => {
        expect(request.admission).toEqual({ id: input.intent.task.id, fingerprint: input.effectiveDigest });
        expect(request).toMatchObject({ profile: input.intent.tasksSpec.taskProfileId, volumeMode: 'persistent', traceId: input.intent.task.traceId });
        environment = { id: request.admission!.id, projectId, state: 'creating', connected: false, traceId: input.intent.task.traceId, podName: 'task', profile: request.profile! };
        throw quotaExceeded('丢失的回执不能被后续容量拒绝掩盖');
      }, getEnvironment: async () => environment,
    } }, claimed);
    expect((await ops.get(input.id))?.state).toBe('succeeded');
    expect((await ops.get(input.id))?.errorCode).toBeNull();
  });

  test('过期 worker 的准入尚可能迟到：新 worker 读不到资源且得到 429 时仍保留 admitting', async () => {
    const ops = drizzleExecutionOperations(tdb.db), input = candidate(); await ops.reserve(input);
    const old = (await ops.claim({ id: input.id, owner: 'old', leaseSeconds: 30 }))!;
    await tdb.db.execute(sql`UPDATE business_task.execution_operations SET lease_until = clock_timestamp() - interval '1 second' WHERE id = ${input.id}`);
    const recovered = (await ops.claim({ id: input.id, owner: 'new', leaseSeconds: 30 }))!;
    expect(recovered.errorCode).toBe('admission_unknown');
    await dispatchTaskAdmission({ operations: ops, environments: {
      createEnvironment: async () => { throw quotaExceeded('currently full'); }, getEnvironment: async () => undefined,
    } }, recovered);
    expect(await ops.get(input.id)).toMatchObject({ state: 'pending', errorCode: 'admission_unknown' });
    expect(await ops.settle(leaseOf(old), 'retryable-rejected', 'quota_exceeded')).toBe(false);
    const next = (await ops.claim({ id: input.id, owner: 'next', leaseSeconds: 30 }))!;
    expect(next.errorCode).toBe('admission_unknown');
    const environment: EnvironmentView = { id: input.intent.task.id as TaskId, projectId, state: 'creating', connected: false, traceId: input.intent.task.traceId, podName: 'task', profile: input.intent.task.taskProfileId };
    await dispatchTaskAdmission({ operations: ops, environments: { createEnvironment: async () => environment, getEnvironment: async () => environment } }, next);
    expect(await ops.get(input.id)).toMatchObject({ state: 'succeeded', errorCode: null });
  });

  test.each([
    { error: quotaExceeded('no capacity'), readFails: false, expected: 'retryable-rejected', code: 'quota_exceeded' },
    { error: validation('invalid profile'), readFails: false, expected: 'failed', code: 'validation' },
    { error: new Error('connection lost, secret must not be stored'), readFails: false, expected: 'pending', code: 'admission_unknown' },
    { error: quotaExceeded('no capacity'), readFails: true, expected: 'pending', code: 'admission_unknown' },
  ])('准入异常分类 $expected / $code / readFails=$readFails', async ({ error, readFails, expected, code }) => {
    const ops = drizzleExecutionOperations(tdb.db), input = candidate(); await ops.reserve(input);
    const claimed = (await ops.claim({ id: input.id, owner: 'worker', leaseSeconds: 30 }))!;
    await dispatchTaskAdmission({ operations: ops, environments: {
      createEnvironment: async () => { throw error; }, getEnvironment: async () => { if (readFails) throw new Error('offline'); return undefined; },
    } }, claimed);
    expect(await ops.get(input.id)).toMatchObject({ state: expected, errorCode: code });
    expect(JSON.stringify(await ops.get(input.id))).not.toContain(error.message);
  });

  test('任务对象先预备再创建，丢回执不释放，明确失败才按可重试性释放', async () => {
    for (const mode of ['success', 'lost-reply', 'unknown', 'quota', 'invalid'] as const) {
      const ops = drizzleExecutionOperations(tdb.db), input = candidate();
      const prepared = { ...input, intent: { ...input.intent, inputObjects: [{ objectId: newResourceId(), sha256: 'a'.repeat(64), path: 'input.bin' }], task: { ...input.intent.task, completionPolicy: 'archive-and-delete' as const } } };
      await ops.reserve(prepared); const claimed = (await ops.claim({ id: input.id, owner: 'inputs', leaseSeconds: 30 }))!;
      const calls: string[] = []; let environment: EnvironmentView | undefined;
      await dispatchTaskAdmission({ operations: ops, taskInputs: {
        prepare: async (request) => { expect(request.items).toEqual(prepared.intent.inputObjects); expect(request.taskId).toBe(input.intent.task.id); calls.push('prepare'); },
        commit: async () => { calls.push('commit'); }, abort: async (_id, _generation, retryable) => { calls.push(`abort:${retryable}`); },
      }, environments: {
        createEnvironment: async (request) => {
          calls.push('create'); expect(request.objectInputsGeneration).toBe(1);
          if (mode === 'quota') throw quotaExceeded('full'); if (mode === 'invalid') throw validation('bad'); if (mode === 'unknown') throw new Error('unknown');
          environment = { id: input.intent.task.id, projectId, state: 'creating', connected: false, traceId: input.intent.task.traceId, podName: 'input', profile: input.intent.task.taskProfileId };
          if (mode === 'lost-reply') throw new Error('lost'); return environment;
        }, getEnvironment: async () => environment,
      } }, claimed);
      expect(calls).toEqual(['prepare', 'create', ...(mode === 'success' || mode === 'lost-reply' ? ['commit'] : mode === 'quota' ? ['abort:true'] : mode === 'invalid' ? ['abort:false'] : [])]);
      expect((await ops.get(input.id))?.state).toBe(mode === 'unknown' ? 'pending' : mode === 'quota' ? 'retryable-rejected' : mode === 'invalid' ? 'failed' : 'succeeded');
    }
  });
});
