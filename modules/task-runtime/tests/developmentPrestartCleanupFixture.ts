// Isolated Task/Resources real-PG and Controller regression. Digital owner transport is controlled here; root E2E uses actual Dev/Session owners.
import { jsonHash } from '@crewstation/kernel';
import { DevelopmentPrestartCleanupEvidenceSchema } from '../domain/development/prestartCleanup';
import type { DevelopmentCleanupSelection } from '../domain/development/cleanupEvidence';
import { closeDevelopmentAdmission } from '../application/development/workloadStop';
import { developmentWorkloadFixture } from './developmentWorkloadFixture';
import { eventWaiter, markPrestartContainers, stoppableApi } from './developmentCleanupFixture';

export async function developmentPrestartCleanupFixture(receiptProtection = true) {
  const f = await developmentWorkloadFixture('native'), input = { ...f.request(), ...(receiptProtection ? { developmentRemovalProtection: { version: 1 as const } } : {}) };
  await f.runtime.api.createNativeExecution(input); await f.runNative();
  const env = await f.load(input.id);
  if (!env.native?.podUid || !env.native.secretUid) throw new Error('native creator did not bind original Pod and Runner Secret');
  await markPrestartContainers(f, env, false);
  await closeDevelopmentAdmission(f.safety, env);
  const before = await f.safety.get(env.render!.workloadConsumerId!);
  if (!before?.admissionClosed || before.startPermit !== null) throw new Error('fixture must use an actual closed/no-grant original consumer');
  const event = eventWaiter(), physical = stoppableApi(f, env, event, true), control = { permitted: true, complete: true, calls: 0 };
  const evidence = async (selection: DevelopmentCleanupSelection, closed: boolean) => {
    const state = (await f.safety.get(selection.consumerId))!;
    return DevelopmentPrestartCleanupEvidenceSchema.parse({ version: 2, kind: 'unbound-no-grant', phase: closed ? 'closed' : 'stopping', numericState: 'unknown',
      selection, consumer: state.consumer, stopProof: closed ? state.stopProof : null, stopProofDigest: closed && state.stopProof ? jsonHash(state.stopProof) : null,
      owner: { payloadDigest: 'a'.repeat(64), firstReason: 'cancelled', acceptedAt: env.createdAt.toISOString(), profileId: selection.profileId,
        profileRevision: selection.profileRevision, protocol: 'opencode', priceBookRevision: 3 } });
  };
  const participant = { advance: async (selection: DevelopmentCleanupSelection) => {
    control.calls++; return control.permitted ? { kind: 'permitted' as const, evidence: await evidence(selection, false) } : { kind: 'waiting' as const, reason: 'owner-pending' };
  }, completePrestart: async (selection: DevelopmentCleanupSelection) => control.complete
    ? { kind: 'permitted' as const, evidence: await evidence(selection, true) } : { kind: 'waiting' as const, reason: 'owner-pending' } };
  f.replace({ developmentCleanup: participant });
  await f.runtime.api.releaseEnvironment(env.id, 'user');
  const observe = f.resources.api.observe;
  f.resources.api.observe = async (value) => {
    const result = await observe(value);
    if ('record' in result && result.record?.id === env.id && (await f.resources.api.get(env.id))?.phase === 'stopped') event.emit('resource-stopped');
    return result;
  };
  const settle = async () => {
    if ((await f.resources.api.get(env.id))?.phase === 'stopped') return;
    const stopped = event.wait('resource-stopped'), controller = f.controller(); controller.observer.start(); await stopped; await controller.observer.stop();
  };
  const finalize = async () => {
    const removed = event.wait('finalizer-removed'), controller = f.controller(); controller.observer.start();
    await f.runNative(); await removed; await controller.reconciled(); await controller.observer.stop();
    await f.runNative(); await settle();
  };
  const close = f.close;
  return { ...f, get runtime() { return f.runtime; }, input, env, participant, control, physical, settle, finalize, wait: event.wait,
    close: async () => { event.close(); await close(); } };
}
export type DevelopmentPrestartCleanupFixture = Awaited<ReturnType<typeof developmentPrestartCleanupFixture>>;
