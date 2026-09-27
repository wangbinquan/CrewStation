import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { DomainPayload, ProjectId, ReleaseId, ServiceId, TraceId } from '@crewstation/contracts';
import { CreateBusinessTaskV3Schema, ManifestSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { registerContractsUseCase } from '../application/registerContracts';
import { admissionTrace, taskAdmissionCandidate, taskRequestDigest } from '../application/taskAdmissionIntent';
import type { TaskAdmissionSource } from '../application/taskAdmissionIntent';
import { businessTaskMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const source: TaskAdmissionSource = { serviceId: newResourceId() as ServiceId, projectId: newResourceId() as ProjectId, identity: 'example/worker', project: 'example', service: 'worker', epoch: null };
const now = new Date('2026-09-27T01:00:00Z'), trace = '0123456789abcdef0123456789abcdef' as TraceId;
function payload(): DomainPayload<'release.registered'> {
  return { occurredAt: now.toISOString(), projectId: source.projectId, serviceId: source.serviceId, releaseId: newResourceId() as ReleaseId, tag: 'v1', commitSha: 'a'.repeat(40), executionMaterials: { 'prompt.md': 'fixed prompt' },
    manifest: ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'DigitalWorker', spec: {
      service: { command: ['bun', 'server.ts'], port: 3000, servicePlanId: newResourceId() },
      tasks: { taskProfileId: newResourceId(), defaultVolumeMode: 'persistent', executionControl: 'fenced', acceptedTaskContractVersions: ['v1'],
        agentProfiles: [{ id: newResourceId(), name: 'worker', compute: { kind: 'default' }, systemPromptFile: 'prompt.md', businessConfig: { allowSystemPromptAppend: true } }] },
    } }),
  };
}

describe.skipIf(!available)('RFC-027 release 任务契约固定', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });

  test('登记完整任务声明、按服务和 release 精确读取；重投不移动 latest 顺序或替换内容', async () => {
    const uow = drizzleUnitOfWork(tdb.db), first = payload(), second = payload();
    const register = registerContractsUseCase({ uow, clock: { now: () => now } });
    await register(first);
    const original = (await uow.read.contracts.forRelease(source.serviceId, first.releaseId))!;
    expect(original.releaseMaterials).toEqual(first.executionMaterials);
    await expect(register({ ...first, executionMaterials: { 'prompt.md': 'changed' } })).rejects.toMatchObject({ details: { code: 'release_contract_conflict' } });
    expect(original.tasksSpec).toEqual(first.manifest.kind === 'DigitalWorker' ? first.manifest.spec.tasks : undefined);
    expect(original.tasksSpec).toMatchObject({ defaultVolumeMode: 'persistent', executionControl: 'fenced', acceptedTaskContractVersions: ['v1'] });
    const later = new Date(now.getTime() + 1000);
    await registerContractsUseCase({ uow, clock: { now: () => later } })(second);
    await registerContractsUseCase({ uow, clock: { now: () => new Date(later.getTime() + 1000) } })(first);
    expect(await uow.read.contracts.forRelease(source.serviceId, first.releaseId)).toEqual(original);
    expect((await uow.read.contracts.latest(source.serviceId))?.releaseId).toBe(second.releaseId);
    expect(await uow.read.contracts.forRelease(newResourceId() as ServiceId, first.releaseId)).toBeUndefined();
    await expect(uow.run((s) => s.contracts.save({ ...original, tag: 'changed' }))).rejects.toMatchObject({ kind: 'conflict' });
    await expect(uow.run((s) => s.contracts.save({ ...original, tasksSpec: { ...original.tasksSpec!, defaultVolumeMode: 'follow-container' } }))).rejects.toMatchObject({ kind: 'conflict' });
  });

  test('旧登记只允许补齐一次，同 release 并发不同默认值只能有一个胜出', async () => {
    const uow = drizzleUnitOfWork(tdb.db), event = payload();
    await registerContractsUseCase({ uow, clock: { now: () => now } })(event);
    const registered = (await uow.read.contracts.forRelease(source.serviceId, event.releaseId))!;
    const { tasksSpec, ...base } = registered;
    const legacy = { ...base, releaseId: newResourceId() as ReleaseId };
    await uow.run((s) => s.contracts.save(legacy));
    const outcomes = await Promise.allSettled(['persistent', 'follow-container'].map((volumeMode) => uow.run((s) => s.contracts.save({ ...legacy, tasksSpec: { ...tasksSpec!, defaultVolumeMode: volumeMode as 'persistent' | 'follow-container' } }))));
    expect(outcomes.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((value) => value.status === 'rejected')).toHaveLength(1);
    const upgraded = (await uow.read.contracts.forRelease(source.serviceId, legacy.releaseId))!;
    expect(upgraded.registeredAt).toEqual(now);
    await uow.run((s) => s.contracts.save(legacy));
    expect(await uow.read.contracts.forRelease(source.serviceId, legacy.releaseId)).toEqual(upgraded);
  });

  test('父任务使用固定 release 的默认卷和套餐，显式覆盖可用；身份标签、缺失和不兼容契约拒绝', async () => {
    const uow = drizzleUnitOfWork(tdb.db), event = payload();
    await registerContractsUseCase({ uow, clock: { now: () => now } })(event);
    const registered = (await uow.read.contracts.forRelease(source.serviceId, event.releaseId))!;
    const input = CreateBusinessTaskV3Schema.parse({ requestKey: 'create-1', taskContractVersion: 'v1' });
    const operation = taskAdmissionCandidate(source, registered, input, trace, now);
    expect(operation.intent.task).toMatchObject({ releaseId: event.releaseId, volumeMode: 'persistent', taskProfileId: registered.tasksSpec!.taskProfileId, traceId: trace, state: 'admitting' });
    expect(operation.intent.releaseMaterials).toEqual(event.executionMaterials);
    expect(operation.intent.tasksSpec).toEqual(registered.tasksSpec!);
    expect(operation.intent.environmentLabels).toEqual({ 'crewstation.io/project': 'example', 'crewstation.io/service': 'worker' });
    const override = newResourceId();
    expect(taskAdmissionCandidate(source, registered, { ...input, volumeMode: 'follow-container', taskProfileId: override }, trace, now).intent.task).toMatchObject({ volumeMode: 'follow-container', taskProfileId: override });
    expect(() => taskAdmissionCandidate(source, registered, { ...input, labels: { 'crewstation.io/project': 'other' } }, trace, now)).toThrow('身份');
    expect(() => taskAdmissionCandidate(source, registered, { ...input, taskContractVersion: 'unsupported' }, trace, now)).toThrow('契约版本');
    const { tasksSpec: _spec, ...old } = registered;
    expect(() => taskAdmissionCandidate(source, old, input, trace, now)).toThrow('完整任务契约');
    expect(() => taskAdmissionCandidate({ ...source, serviceId: newResourceId() as ServiceId }, registered, input, trace, now)).toThrow('完整任务契约');
    expect(taskRequestDigest({ ...input, traceId: trace, fence: { epoch: 1, leaseId: newResourceId(), instanceId: newResourceId() } })).toBe(taskRequestDigest(input));
  });
});

test('trace 取 body 或合法 header，不一致与无效 header 明确拒绝', () => {
  expect(admissionTrace(trace, undefined)).toBe(trace);
  expect(admissionTrace(undefined, trace)).toBe(trace);
  expect(admissionTrace(trace, trace)).toBe(trace);
  expect(admissionTrace(undefined, undefined)).toMatch(/^[a-f0-9]{32}$/);
  expect(() => admissionTrace(trace, 'f'.repeat(32))).toThrow('不一致');
  expect(() => admissionTrace(trace, 'invalid')).toThrow('32 位');
});
