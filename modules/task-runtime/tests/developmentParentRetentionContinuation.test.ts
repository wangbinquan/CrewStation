// Regression: the real D9 resync must not invalidate the immutable compensation witness.
// Real PG/public Task/Resources/worker chain; controlled K8s and digital participant, no model calls.
import { afterEach, describe, expect, test } from 'bun:test';
import { DomainTopic } from '@crewstation/contracts';
import { Resources } from '@crewstation/k8s';
import { jsonHash, noopLogger } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { Worker } from '@crewstation/queue';
import { sql } from 'drizzle-orm';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { resyncLedger } from '../application/ledgerResync';
import { originalParentCompletion, requireParentCompletionTransition } from '../domain/development/parentCompletion';
import type { UnitOfWork } from '../ports/unitOfWork';
import { developmentParentTransitionHash, readDevelopmentParentEnding } from '../domain/development/parentEnding';
import { developmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import type { DevelopmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import type { DevelopmentParentEnding } from '../ports/developmentParentEnding';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('completed development parent retention continuation (real PG)', () => {
  let f: DevelopmentParentPhysicalFixture;
  afterEach(async () => { await f?.close(); });
  const request = async (administrator: boolean) => {
    const checked = await f.runtime.api.inspectRebuild(f.projectId, administrator), profile = checked.profiles[0]!;
    return { requestId: crypto.randomUUID(), expectedTaskId: f.parent.id, expectedUpdatedAt: checked.updatedAt,
      expectedPodUid: checked.podUid, expectedVolumeUid: checked.volume.uid, ...(administrator ? { reason: 'administrator-restart' as const } : {}),
      profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } };
  };
  const stop = async (physical: DevelopmentParentPhysicalFixture['parentPhysical']) => {
    const controller = f.controller(); controller.observer.start();
    try { await f.runEnding(); await physical.waitRemoved(); } finally { await controller.observer.stop(); }
    await f.retry();
  };
  const compensate = async (mode: 'native' | 'ledger') => {
    f = await developmentParentPhysicalFixture(mode);
    await f.runtime.api.requestRebuild(f.projectId, await request(true)); await stop(f.parentPhysical);
    await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at=clock_timestamp()-interval '1 second'`);
    await (f.runtime.workers[0] as Worker).runOnce();
    if (mode === 'ledger') {
      const applied = f.receipt('rebuild-reconciled'), controller = f.controller(); controller.observer.start();
      try { await applied; } finally { await controller.observer.stop(); }
    }
    const prepared = await f.load(f.parent.id), physical = await f.rebuiltPhysical();
    await f.runtime.api.markFailed(prepared.id, 'controlled retention startup failure'); await stop(physical);
    const failed = await f.load(f.parent.id), pointer = readDevelopmentParentEnding(failed)!;
    const ending = (await f.uow.read.parentEnding!.endings.get(pointer.endingId))!;
    expect(failed.state).toBe('failed'); expect(ending.phase).toBe('complete');
    expect(ending.completionWitness?.['outcome']).toBe('compensation');
    expect(ending.completionWitness?.['afterTransitionHash']).toBe(developmentParentTransitionHash(failed));
    return { failed, ending };
  };
  const snapshot = async () => {
    const record = (await f.resources.api.get(f.parent.id))!;
    return { id: record.id, projectId: record.projectId ?? null, owner: record.owner, kind: record.kind,
      generation: record.generation, version: record.version, retainUntil: record.retainUntil?.toISOString() ?? null,
      phaseSince: record.phaseSince.toISOString(), specHash: jsonHash(record.spec) };
  };
  const expire = async () => {
    await f.tdb.db.execute(sql`UPDATE resources.records SET retain_until=clock_timestamp()-interval '1 second' WHERE id=${f.parent.id}`);
    expect((await f.runtime.api.inspectResourceEnding!('retention', await snapshot())).status).toBe('permitted');
    await f.resources.maintainOnce();
    const record = (await f.resources.api.get(f.parent.id))!;
    expect(record.desired).toBe('absent'); expect(record.releaseReason?.code).toBe('retention-expired');
    expect(record.retainUntil).toBeUndefined();
  };
  const resync = async () => {
    const warnings: string[] = [], logger = { ...noopLogger, warn: (message: string, fields?: Readonly<Record<string, unknown>>) => { warnings.push(message + ': ' + String(fields?.['error'] ?? '')); } };
    const uow = drizzleUnitOfWork(f.tdb.db, { ledger: f.ledger, logger });
    const count = await resyncLedger(uow, f.ledger, logger);
    return { count, warnings, uow };
  };
  const rawEnding = async (endingId: string) => {
    const rows = await f.tdb.db.execute<{ value: Record<string, unknown> }>(sql`SELECT to_jsonb(e) AS value FROM task_runtime.development_parent_endings AS e WHERE id=${endingId}`);
    return rows[0]!.value;
  };
  const rejectEndingUpdate = async (endingId: string, update: ReturnType<typeof sql>, expected: Record<string, unknown>) => {
    let failure: unknown;
    try { await f.tdb.db.execute(sql`UPDATE task_runtime.development_parent_endings SET ${update} WHERE id=${endingId}`); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    const cause = failure as { message: string; cause?: { message: string } };
    expect(cause.cause?.message ?? cause.message).toMatch(/development parent (ending identity|ending membership|completion witness) is immutable/);
    expect(await rawEnding(endingId)).toEqual(expected);
  };
  const guardBeforeRetention = async (failed: TaskEnvironment, ending: DevelopmentParentEnding) => {
    const original = await rawEnding(ending.id), witness = ending.completionWitness!;
    const resource = (await f.resources.api.get(failed.id))!;
    const receipt = {
      version: 1, endingId: ending.id, epochHash: ending.epochHash, sourceCompletionWitnessHash: jsonHash(witness),
      beforeTransitionHash: witness['afterTransitionHash'], afterTransitionHash: developmentParentTransitionHash({ ...failed, state: 'released' }),
      runnerTokenHash: failed.runnerTokenHash, retiredAt: new Date().toISOString(),
      resource: { id: resource.id, projectId: resource.projectId, ownerRef: resource.owner.ref, kind: resource.kind,
        generation: resource.generation, specHash: jsonHash(resource.spec), retainUntil: null, releaseReason: 'retention-expired' },
    };
    const invalid = async (value: unknown) => rejectEndingUpdate(ending.id, sql`progress=${JSON.stringify({ ...ending.progress, retentionTransition: value })}::jsonb`, original);
    const invalidReceipts: unknown[] = [null, false, 1, 'receipt', [], { ...receipt, extra: true }, { ...receipt, version: '1' }, { ...receipt, version: 2 },
      { ...receipt, endingId: crypto.randomUUID() }, { ...receipt, epochHash: '0'.repeat(64) },
      { ...receipt, beforeTransitionHash: '0'.repeat(64) }, { ...receipt, runnerTokenHash: '0'.repeat(64) }];
    for (const key of Object.keys(receipt)) { const value: Record<string, unknown> = { ...receipt }; delete value[key]; invalidReceipts.push(value); }
    for (const key of ['epochHash', 'sourceCompletionWitnessHash', 'beforeTransitionHash', 'afterTransitionHash', 'runnerTokenHash']) {
      invalidReceipts.push({ ...receipt, [key]: 'A'.repeat(64) }, { ...receipt, [key]: 123 }, { ...receipt, [key]: null });
    }
    for (const value of [null, false, 1, 'resource', [], { ...receipt.resource, extra: true }]) invalidReceipts.push({ ...receipt, resource: value });
    for (const key of Object.keys(receipt.resource)) {
      const value: Record<string, unknown> = { ...receipt.resource }; delete value[key]; invalidReceipts.push({ ...receipt, resource: value });
    }
    for (const key of ['id', 'projectId', 'ownerRef']) invalidReceipts.push({ ...receipt, resource: { ...receipt.resource, [key]: crypto.randomUUID() } });
    for (const generation of [0, -1, 1.5, '1', 9007199254740992]) invalidReceipts.push({ ...receipt, resource: { ...receipt.resource, generation } });
    for (const value of [{ kind: 'business' }, { retainUntil: new Date().toISOString() }, { retainUntil: false }, { releaseReason: 'requested' }, { specHash: 'invalid' }]) {
      invalidReceipts.push({ ...receipt, resource: { ...receipt.resource, ...value } });
    }
    for (const retiredAt of [null, false, 'not-a-date', '2026-02-31T12:00:00.000Z', '2026-10-03T12:00:00+00:00', new Date(Date.parse(String(witness['completedAt'])) - 1).toISOString()]) invalidReceipts.push({ ...receipt, retiredAt });
    for (const value of invalidReceipts) await invalid(value);
    // A valid-shaped append cannot smuggle another column or progress-material change.
    const append = sql`progress=${JSON.stringify({ ...ending.progress, retentionTransition: receipt })}::jsonb`;
    await rejectEndingUpdate(ending.id, sql`${append}, updated_at=updated_at+interval '1 second'`, original);
    await rejectEndingUpdate(ending.id, sql`${append}, completion_witness='{}'::jsonb`, original);
    await rejectEndingUpdate(ending.id, sql`${append}, status='pending'`, original);
    await rejectEndingUpdate(ending.id, sql`${append}, member_count=member_count+1`, original);
    await rejectEndingUpdate(ending.id, sql`${append}, epoch_hash=${'0'.repeat(64)}`, original);
    await rejectEndingUpdate(ending.id, sql`progress=${JSON.stringify({ ...ending.progress, retentionTransition: receipt, extraMaterial: true })}::jsonb`, original);
    await rejectEndingUpdate(ending.id, sql`progress='null'::jsonb`, original);
    return original;
  };
  for (const mode of ['native', 'ledger'] as const) test(mode + ': original failure, actual expiry and projected resync preserve completion and permit real compaction', async () => {
    const { failed, ending } = await compensate(mode), materials = jsonHash(ending.progress);
    const summary = await f.uow.read.parentEnding!.children.summary(ending.id), objects = await f.uow.read.parentEnding!.objects.list(ending.id);
    const consumer = await f.safety.get(ending.id);
    await expire(); const frozenRow = await guardBeforeRetention(failed, ending);
    // Fail after the original SQL event write: Task, receipt, Resource projection and event must all roll back.
    const abortWarnings: string[] = [], logger = { ...noopLogger, warn: (message: string, fields?: Readonly<Record<string, unknown>>) => { abortWarnings.push(message + ': ' + String(fields?.['error'] ?? '')); } };
    const actualUow = drizzleUnitOfWork(f.tdb.db, { ledger: f.ledger, logger });
    const faultUow: UnitOfWork = { read: actualUow.read, run: (work) => actualUow.run((scope) => work({ ...scope, events: {
      publish: async (topic, payload) => { await scope.events.publish(topic, payload); if (topic === DomainTopic.taskReleased) throw new Error('controlled-release-commit-failure'); },
    } })) };
    await resyncLedger(faultUow, f.ledger, logger);
    expect(abortWarnings.some((warning) => warning.includes('controlled-release-commit-failure'))).toBe(true);
    expect(await f.load(f.parent.id)).toEqual(failed); expect(await rawEnding(ending.id)).toEqual(frozenRow);
    expect((await f.resources.api.get(f.parent.id))?.desired).toBe('absent');
    const rolledBack = await f.tdb.db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM platform_infra.domain_events WHERE topic=${DomainTopic.taskReleased} AND payload->>'taskId'=${failed.id}`);
    expect(rolledBack[0]?.count).toBe('0');
    const first = await resync(); expect(first.warnings).toEqual([]); expect(first.count).toBeGreaterThan(0);
    const released = await f.load(f.parent.id), current = (await f.uow.read.parentEnding!.endings.get(ending.id))!;
    expect(released.state).toBe('released'); expect(released.runnerTokenHash).toBe(failed.runnerTokenHash);
    expect(current.completionWitness).toEqual(ending.completionWitness);
    const witness = originalParentCompletion(current.completionWitness, current);
    expect(() => requireParentCompletionTransition(released, current, witness)).not.toThrow();
    expect(() => requireParentCompletionTransition(failed, ending, witness)).not.toThrow();
    expect(() => requireParentCompletionTransition(released, ending, witness)).toThrow();
    const receipt = current.progress['retentionTransition'] as Record<string, unknown>;
    for (const invalid of [null, false, undefined, { ...receipt, sourceCompletionWitnessHash: '0'.repeat(64) },
      { ...receipt, afterTransitionHash: '0'.repeat(64) }, { ...receipt, runnerTokenHash: '0'.repeat(64) },
      { ...receipt, resource: { ...(receipt['resource'] as Record<string, unknown>), specHash: '0'.repeat(64) } }]) {
      expect(() => requireParentCompletionTransition(released, { ...current, progress: { ...current.progress, retentionTransition: invalid } }, witness)).toThrow();
    }
    expect(() => requireParentCompletionTransition({ ...released, runnerTokenHash: '0'.repeat(64) }, current, witness)).toThrow();
    const appendedRow = await rawEnding(ending.id), originalColumns = { ...frozenRow }, appendedColumns = { ...appendedRow };
    delete originalColumns['progress']; delete appendedColumns['progress']; expect(appendedColumns).toEqual(originalColumns);
    await rejectEndingUpdate(ending.id, sql`progress=${JSON.stringify(ending.progress)}::jsonb`, appendedRow);
    await rejectEndingUpdate(ending.id, sql`progress=jsonb_set(progress, '{retentionTransition,retiredAt}', to_jsonb(clock_timestamp()::text))`, appendedRow);
    await rejectEndingUpdate(ending.id, sql`updated_at=updated_at+interval '1 second'`, appendedRow);
    expect(developmentParentTransitionHash(released)).not.toBe(developmentParentTransitionHash(failed));
    // Old implementation rewrote Task but left its only witness pointing at failed, so this stayed waiting forever.
    expect((await f.runtime.api.inspectResourceEnding!('compaction', await snapshot())).status).toBe('permitted');
    expect(current.progress['retentionTransition']).toBeTruthy();
    const { retentionTransition: _retention, ...original } = current.progress; expect(jsonHash(original)).toBe(materials);
    expect(await f.uow.read.parentEnding!.children.summary(ending.id)).toEqual(summary);
    expect(await f.uow.read.parentEnding!.objects.list(ending.id)).toEqual(objects); expect(await f.safety.get(ending.id)).toEqual(consumer);
    f.replace(); expect((await resync()).warnings).toEqual([]);
    expect((await f.uow.read.parentEnding!.endings.get(ending.id))?.progress['retentionTransition']).toEqual(current.progress['retentionTransition']);
    const events = await f.tdb.db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM platform_infra.domain_events WHERE topic=${DomainTopic.taskReleased} AND payload->>'taskId'=${failed.id}`);
    expect(events[0]?.count).toBe('1');
    await expect(f.runtime.api.inspectRebuild(f.projectId)).rejects.toThrow();
    expect((await f.k8s.get(Resources.PersistentVolumeClaim!, failed.pvcName, failed.namespace))?.metadata.uid).toBe(f.pvc.metadata.uid);
    await f.settleParent();
    await f.tdb.db.execute(sql`UPDATE resources.records SET phase_since=clock_timestamp()-interval '8 days' WHERE id=${failed.id}`);
    await f.resources.maintainOnce(); expect((await f.resources.api.get(failed.id))?.compactedAt).toBeInstanceOf(Date);
  }, 30000);
  // Restart can run Resources maintenance before Task resync. Preserve its original sealed spec.
  for (const mode of ['native', 'ledger'] as const) test(mode + ': delayed resync cannot let compaction erase the original retention evidence', async () => {
    const { failed, ending } = await compensate(mode);
    await expire(); await f.settleParent();
    await f.tdb.db.execute(sql`UPDATE resources.records SET phase_since=clock_timestamp()-interval '8 days' WHERE id=${failed.id}`);
    const before = (await f.resources.api.get(failed.id))!;
    expect(before.desired).toBe('absent'); expect(before.phase).toBe('stopped'); expect(before.compactedAt).toBeUndefined();
    expect((await f.uow.read.environments.getById(failed.id))?.state).toBe('failed');
    expect((await f.uow.read.parentEnding!.endings.get(ending.id))?.progress['retentionTransition']).toBeUndefined();
    f.replace();
    await f.resources.maintainOnce();
    const waiting = (await f.resources.api.get(failed.id))!;
    expect(waiting.compactedAt).toBeUndefined(); expect(waiting.spec).toEqual(before.spec);
    const result = await resync(); expect(result.warnings).toEqual([]); expect(result.count).toBeGreaterThan(0);
    expect((await f.uow.read.environments.getById(failed.id))?.state).toBe('released');
    expect((await f.uow.read.parentEnding!.endings.get(ending.id))?.progress['retentionTransition']).toBeTruthy();
    expect((await f.runtime.api.inspectResourceEnding!('compaction', await snapshot())).status).toBe('permitted');
    // The waiting page already advanced the original sweep cursor; its next EOF starts a fresh complete sweep.
    await f.resources.maintainOnce(); await f.resources.maintainOnce();
    expect((await f.resources.api.get(failed.id))?.compactedAt).toBeInstanceOf(Date);
    const events = await f.tdb.db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM platform_infra.domain_events WHERE topic=${DomainTopic.taskReleased} AND payload->>'taskId'=${failed.id}`);
    expect(events[0]?.count).toBe('1');
  }, 30000);

});
