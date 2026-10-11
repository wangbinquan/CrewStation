import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '../../packages/testkit';
import { Resources } from '../../packages/k8s';
import { TaskIdSchema } from '../../packages/contracts';
import { developmentCleanupSelection } from '../../modules/task-runtime/domain/development/cleanupSelection';
import { developmentPrestartCleanupChain } from './developmentPrestartCleanupFixture';
import type { DevelopmentPrestartCleanupChain } from './developmentPrestartCleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-034 real unbound/no-grant original owner cleanup chain', () => {
  let f: DevelopmentPrestartCleanupChain;
  afterEach(async () => { await f?.close(); });
  test('real PG owners close without creating a numeric stream; actual Controller proof precedes credential/quota release', async () => {
    f = await developmentPrestartCleanupChain(); const accepted = (await f.owner.get(f.env.id))!.price;
    await f.runNative();
    expect(await f.session.api.lookupDevelopmentUsage(f.env.id)).toEqual({ version: 1, kind: 'absent', runtimeTaskId: f.env.id });
    expect(await f.store.get(f.env.id)).toMatchObject({ stage: 'awaiting-stop', stop: null, closure: null, logicalResult: null, actualEndedAt: null, prestartClosure: null });
    expect(await f.owner.get(f.env.id)).toMatchObject({ binding: null, closeReason: 'cancelled', price: accepted });
    expect((await f.load(f.env.id)).native?.developmentCleanup).toMatchObject({ version: 2, phase: 'stopping', numericState: 'unknown' });
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
    await f.finalize(); const ended = await f.store.get(f.env.id);
    expect(ended).toBeDefined(); if (!ended) throw new Error('original ending missing');
    expect(ended).toMatchObject({ stage: 'prestart-closed', stop: null, closure: null, logicalResult: null, actualEndedAt: null,
      prestartClosure: { version: 2, phase: 'closed', numericState: 'unknown', stopProof: { type: 'kubelet-terminated', podUid: f.env.native!.podUid } } });
    expect(await f.session.api.lookupDevelopmentUsage(f.env.id)).toEqual({ version: 1, kind: 'absent', runtimeTaskId: f.env.id });
    expect(f.calls.every((v) => v === 'lookup')).toBe(true);
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(1);
    expect(await f.store.claim(f.env.id, f.clock.now().toISOString())).toBeUndefined();
    expect(await f.store.request({ executionTaskId: f.env.id, expectedRegistration: null, reason: 'workspace-released', observedAt: f.clock.now().toISOString() })).toEqual(ended);
    expect(await f.owner.get(f.env.id)).toMatchObject({ binding: null, closeReason: 'cancelled', price: accepted });
  }, 15_000);
  test('a real Session lookup failure cannot be treated as absence or issue a physical deletion', async () => {
    f = await developmentPrestartCleanupChain(); f.control.lookupFailure = true; await f.runNative();
    expect(f.physical.state.deleteRequests).toEqual([]); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
    expect(await f.k8s.get(Resources.Secret!, f.env.podName + '-runner', f.env.namespace)).toBeDefined();
    expect((await f.load(f.env.id)).native?.developmentCleanup).toBeUndefined();
    f.control.lookupFailure = false; await f.finalize();
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(1);
  }, 15_000);
  test('an actual pre-existing Session row blocks the unknown outlet without changing the original registration', async () => {
    f = await developmentPrestartCleanupChain();
    const selection = developmentCleanupSelection(await f.load(f.env.id))!;
    const registration = { runtimeTaskId: f.env.id, key: { executionId: f.env.id, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: f.prepared.payloadDigest },
      identity: selection.identity, podUid: selection.podUid, profileId: selection.profileId, profileRevision: selection.profileRevision };
    await f.session.api.registerDevelopmentUsage(registration);
    await f.runNative(); expect(f.physical.state.deleteRequests).toEqual([]); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
    expect((await f.session.api.lookupDevelopmentUsage(TaskIdSchema.parse(f.env.id))).kind).toBe('registered');
    expect((await f.owner.get(f.env.id))?.binding).toBeNull();
  }, 15_000);
});
