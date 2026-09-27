import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { ProjectId, ReleaseId, ServiceId, TraceId } from '@crewstation/contracts';
import { CreateBusinessTaskV3Schema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { drizzleExecutionControls } from '../adapters/persistence/executionControl';
import { drizzleExecutionOperations } from '../adapters/persistence/executionOperations';
import { taskAdmissionCandidate } from '../application/taskAdmissionIntent';
import type { ExecutionAuthority, ExecutionControl } from '../domain/executionControl';
import { controlDto } from '../domain/executionControl';

import { businessTaskMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const authority = (): ExecutionAuthority => ({ releaseId: newResourceId() as ReleaseId, physicalSlot: 'blue', podUid: newResourceId(), ready: true, role: 'prod' });
const lease = (control: ExecutionControl) => ({ expectedEpoch: control.epoch, leaseId: control.leaseId!, instanceId: control.leaseOwner! });
const fence = (control: ExecutionControl) => ({ epoch: control.epoch, leaseId: control.leaseId!, instanceId: control.leaseOwner! });
function candidate(serviceId: string, source: ExecutionAuthority, epoch: number) {
  const taskSpec = { taskProfileId: newResourceId(), defaultVolumeMode: 'persistent' as const, executionControl: 'fenced' as const, acceptedTaskContractVersions: ['v1'], agentProfiles: [], outputContracts: [] };
  return taskAdmissionCandidate({ serviceId: serviceId as ServiceId, projectId: newResourceId() as ProjectId, identity: 'demo/demo', project: 'demo', service: 'demo', epoch },
    { serviceId: serviceId as ServiceId, releaseId: source.releaseId, tag: 'v1', tasksSpec: taskSpec, agentProfiles: [], outputContracts: [], registeredAt: new Date() },
    CreateBusinessTaskV3Schema.parse({ requestKey: newResourceId(), taskContractVersion: 'v1' }), '0123456789abcdef0123456789abcdef' as TraceId, new Date());
}

describe.skipIf(!available)('RFC-027 执行权与受理事务屏障', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  const active = async () => {
    const serviceId = newResourceId(), source = authority(), controls = drizzleExecutionControls(tdb.db);
    const preparing = (await controls.claim(serviceId, source, { instanceId: newResourceId() })).control!;
    const control = (await controls.activate(serviceId, source, { ...lease(preparing), preparationDigest: 'a'.repeat(64) })).control!;
    return { serviceId, source, control, controls, ops: drizzleExecutionOperations(tdb.db) };
  };

  test('多个实例并发 claim 只有一个 preparing；准备完成前不能受理，重复 claim 与 activate 可重放', async () => {
    const serviceId = newResourceId(), source = authority(), controls = drizzleExecutionControls(tdb.db), ops = drizzleExecutionOperations(tdb.db);
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => controls.claim(serviceId, source, { instanceId: newResourceId() })));
    const winners = results.filter((r) => r.status === 'fulfilled'); expect(winners).toHaveLength(1);
    const current = winners[0]!.value.control!;
    expect(current.phase).toBe('preparing');
    expect((await controls.claim(serviceId, source, { instanceId: current.leaseOwner! })).control).toEqual(current);
    const request = candidate(serviceId, source, current.epoch);
    await expect(ops.reserve(request, { source, fence: fence(current) })).rejects.toMatchObject({ details: { code: 'stale_generation' } });
    expect(await ops.find(request)).toBeUndefined();
    const activated = (await controls.activate(serviceId, source, { ...lease(current), preparationDigest: 'b'.repeat(64) })).control!;
    expect((await controls.activate(serviceId, source, { ...lease(activated), preparationDigest: 'b'.repeat(64) })).control).toEqual(activated);
    await expect(controls.activate(serviceId, source, { ...lease(activated), preparationDigest: 'c'.repeat(64) })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await ops.reserve(request, { source, fence: fence(activated) })).created).toBe(true);
  });

  test('错误槽、Pod 与未就绪来源拒绝；过期不能续租复活，新 holder 总是新 epoch', async () => {
    const { serviceId, source, control, controls } = await active();
    await expect(controls.claim(newResourceId(), { ...source, role: 'preview' }, { instanceId: newResourceId() })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(controls.claim(newResourceId(), { ...source, ready: false }, { instanceId: newResourceId() })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(controls.renew(serviceId, { ...source, podUid: 'wrong' }, lease(control))).rejects.toMatchObject({ details: { code: 'stale_generation' } });
    await expect(controls.renew(serviceId, { ...source, releaseId: newResourceId() as ReleaseId }, lease(control))).rejects.toMatchObject({ kind: 'forbidden' });
    await tdb.db.execute(sql`UPDATE business_task.execution_controls SET body = jsonb_set(body, '{leaseExpiresAt}', to_jsonb((clock_timestamp() - interval '1 second')::text)) WHERE service_id = ${serviceId}`);
    const expired = await controls.read(serviceId);
    expect(controlDto(expired.control, expired.now)).toMatchObject({ phase: 'inactive', leaseOwner: null });
    await expect(controls.renew(serviceId, source, lease(control))).rejects.toMatchObject({ details: { code: 'stale_generation' } });
    const next = (await controls.claim(serviceId, { ...source, podUid: 'new' }, { instanceId: newResourceId() })).control!;
    expect(next.epoch).toBe(control.epoch + 1); expect(next.phase).toBe('preparing');
  });

  test('冻结与准入互斥；旧世代回执可读，新副作用拒绝；未派发意图由新 holder 原 ID 接管', async () => {
    const { serviceId, source, control, controls, ops } = await active();
    const request = candidate(serviceId, source, control.epoch), authorization = { source, fence: fence(control) };
    const accepted = (await ops.reserve(request, authorization)).operation;
    const target = { ...authority(), physicalSlot: 'green' as const, role: 'preview' as const };
    const handoff = { operationId: newResourceId(), expectedActiveReleaseId: source.releaseId, targetReleaseId: target.releaseId, targetSlot: target.physicalSlot };
    const frozen = await controls.freeze(serviceId, handoff);
    expect(frozen.quiescent).toBe(true);
    expect((await controls.freeze(serviceId, handoff)).control).toEqual(frozen.control);
    await expect(controls.freeze(serviceId, { ...handoff, expectedActiveReleaseId: target.releaseId })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await ops.reserve(request)).operation).toEqual(accepted);
    await expect(ops.reserve(candidate(serviceId, source, control.epoch), authorization)).rejects.toMatchObject({ kind: 'forbidden' });
    expect(await ops.claim({ id: request.id, owner: 'worker', leaseSeconds: 30 })).toBeUndefined();
    const preparing = (await controls.claim(serviceId, target, { instanceId: newResourceId() })).control!;
    const receipt = { ...lease(preparing), operationId: handoff.operationId, acceptedTaskContractVersions: ['v1'], preparationDigest: 'a'.repeat(64) };
    await controls.handoffReady(serviceId, target, receipt);
    await expect(controls.activate(serviceId, target, receipt)).rejects.toMatchObject({ kind: 'precondition' });
    await controls.routeObserved(serviceId, handoff.operationId, target.releaseId, 'green');
    const activated = (await controls.activate(serviceId, target, receipt)).control!;
    expect(activated).toMatchObject({ activeReleaseId: target.releaseId, phase: 'active', handoff: { stage: 'complete' } });
    expect((await controls.handoffReady(serviceId, target, receipt)).control).toEqual(activated);
    expect(await ops.claim({ id: request.id, owner: 'worker', leaseSeconds: 30 })).toBeUndefined();
    const adopted = await ops.adoptPending(request, request.requestDigest, { source: target, fence: fence(activated) });
    expect(adopted.intent).toEqual(accepted.intent); expect(adopted.epoch).toBe(activated.epoch);
    expect((await ops.claim({ id: request.id, owner: 'worker', leaseSeconds: 30 }))?.id).toBe(request.id);
    await expect(controls.renew(serviceId, source, lease(control))).rejects.toMatchObject({ kind: 'forbidden' });
  });

  test('在途派发没有结果时交接保持冻结；原句柄恢复对账后才允许目标准备', async () => {
    const { serviceId, source, control, controls, ops } = await active();
    const request = candidate(serviceId, source, control.epoch);
    await ops.reserve(request, { source, fence: fence(control) });
    const claimed = (await ops.claim({ id: request.id, owner: 'old', leaseSeconds: 30 }))!;
    const target = { ...authority(), physicalSlot: 'green' as const, role: 'preview' as const };
    const handoff = { operationId: newResourceId(), expectedActiveReleaseId: source.releaseId, targetReleaseId: target.releaseId, targetSlot: target.physicalSlot };
    expect((await controls.freeze(serviceId, handoff)).quiescent).toBe(false);
    await expect(controls.claim(serviceId, target, { instanceId: newResourceId() })).rejects.toMatchObject({ details: { code: 'dispatch_in_flight' } });
    await tdb.db.execute(sql`UPDATE business_task.execution_operations SET lease_until = clock_timestamp() - interval '1 second' WHERE id = ${request.id}`);
    const recovered = (await ops.claim({ id: request.id, owner: 'new', leaseSeconds: 30 }))!;
    expect(recovered.id).toBe(claimed.id); expect(recovered.errorCode).toBe('admission_unknown');
    await ops.settle({ id: recovered.id, owner: recovered.lease!.owner, revision: recovered.revision }, 'succeeded');
    expect((await controls.freeze(serviceId, handoff)).quiescent).toBe(true);
    const preparing = (await controls.claim(serviceId, target, { instanceId: newResourceId() })).control!;
    await expect(controls.handoffReady(serviceId, target, { ...lease(preparing), operationId: handoff.operationId, acceptedTaskContractVersions: ['v2'], preparationDigest: 'a'.repeat(64) })).rejects.toMatchObject({ details: { code: 'task_contract_unsupported' } });
  });

  test('启用 fenced 后不能以 legacy 请求绕过；释放租约会阻止 pending 后台派发', async () => {
    const { serviceId, source, control, controls, ops } = await active();
    const request = candidate(serviceId, source, control.epoch);
    request.intent.tasksSpec.executionControl = 'legacy';
    await expect(ops.reserve(request)).rejects.toMatchObject({ details: { code: 'stale_generation' } });
    await ops.reserve(request, { source, fence: fence(control) });
    await controls.release(serviceId, source, lease(control));
    expect(await ops.claim({ id: request.id, owner: 'worker', leaseSeconds: 30 })).toBeUndefined();
    await expect(ops.adoptPending(request, request.requestDigest, { source, fence: fence(control) })).rejects.toMatchObject({ details: { code: 'stale_generation' } });
  });

  test('真实并发冻结与新受理：要么先落意图后冻结，要么拒绝，不存在冻结后拿旧 epoch 的派发票据', async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { serviceId, source, control, controls, ops } = await active();
      const request = candidate(serviceId, source, control.epoch);
      const actions = [
        () => ops.reserve(request, { source, fence: fence(control) }),
        () => controls.freeze(serviceId, { operationId: newResourceId(), expectedActiveReleaseId: source.releaseId, targetReleaseId: newResourceId() as ReleaseId, targetSlot: 'green' }),
      ];
      if (attempt % 2) actions.reverse();
      const outcomes = await Promise.allSettled(actions.map((action) => action()));
      expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
      const accepted = await ops.find(request);
      if (accepted) expect(accepted).toMatchObject({ epoch: control.epoch, state: 'pending' });
      expect((await controls.read(serviceId)).control?.phase).toBe('frozen');
      expect(await ops.claim({ id: request.id, owner: 'late', leaseSeconds: 30 })).toBeUndefined();
    }
  });
});
