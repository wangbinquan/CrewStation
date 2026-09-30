import type { Database } from '@crewstation/persistence';
import type { DevelopmentUsageDrainReason, DevelopmentUsageKey, DevelopmentUsageReceipt, DevelopmentUsageStopReceipt, TaskId } from '@crewstation/contracts';
import { DevelopmentUsageReceiptSchema, StoredDevelopmentUsageSchema } from '@crewstation/contracts';
import type { DevelopmentEndingDeps, DevelopmentEndingSession } from '../ports/developmentEnding';
import { developmentEndingStore } from '../adapters/persistence/ending/store';
import { developmentDispatchFixture } from './developmentDispatchFixture';

export async function developmentEndingFixture(db: Database, options: { bound?: boolean; selected?: boolean } = {}) {
  const f = await developmentDispatchFixture(db, { ...options, bound: options.selected !== false && options.bound !== false });
  const control = { now: '2026-09-30T00:20:00.000Z', stopState: 'finished' as DevelopmentUsageStopReceipt['state'], result: 'completed' as NonNullable<DevelopmentUsageReceipt['result']>,
    sequence: 0, copied: 0, closure: 'complete' as 'complete' | 'interrupted' | 'pending', stopFailure: false, drainFailure: false,
    onStop: undefined as (() => Promise<void>) | undefined };
  const clock = { now: () => new Date(control.now) }, store = developmentEndingStore(db, clock);
  const drains: DevelopmentUsageDrainReason[] = [];
  const session: DevelopmentEndingSession = {
    registerDevelopmentUsage: f.session.registerDevelopmentUsage,
    sendCommand: async (id, command) => {
      if (command.type !== 'stopDevelopmentAgent') throw new Error('ending must not start a model');
      f.calls.push(structuredClone(command));
      const registered = f.stored.get(id);
      if (!registered || JSON.stringify(registered.registration.key) !== JSON.stringify(command.admission.key)) throw new Error('original registration is required first');
      if (control.stopFailure) throw new Error('stop ACK lost');
      await control.onStop?.();
      const finished = control.stopState !== 'stopping';
      const { key, podUid, identity, profileId, profileRevision } = registered.registration;
      const receipt = DevelopmentUsageReceiptSchema.parse({ key, podUid, identity, profileId, profileRevision, phase: finished ? 'finished' : 'running',
        lastSequence: control.sequence, acknowledgedSequence: 0, finalThrough: finished && control.stopState !== 'unknown' ? control.sequence : null,
        result: finished ? (control.stopState === 'prevented' ? 'cancelled' : control.result) : null, interruption: control.stopState === 'unknown' ? 'runner-restarted' : null });
      registered.receipt = receipt;
      return { version: 1, state: control.stopState, receipt };
    },
    requestDevelopmentUsageDrain: async (id: TaskId, key: DevelopmentUsageKey, reason: DevelopmentUsageDrainReason) => {
      if (control.drainFailure) throw new Error('Session temporarily disconnected');
      const stored = f.stored.get(id);
      if (!stored || JSON.stringify(stored.registration.key) !== JSON.stringify(key)) throw new Error('wrong original key');
      if (stored.drainReason && stored.drainReason !== reason) throw new Error('first Session drain reason cannot change');
      drains.push(reason); stored.drainReason ??= reason; stored.persistedThrough = control.copied;
      const receipt = stored.receipt, n = receipt?.lastSequence ?? null, complete = control.closure === 'complete' && receipt?.phase === 'finished' && receipt.interruption === null && n === control.copied;
      stored.complete = !!complete; stored.closure = null;
      if (complete) stored.closure = { status: 'complete', persistedThrough: control.copied, reportedThrough: n, missingAfter: null, missingThrough: null, tailUnknown: false, reason: null, closedAt: control.now };
      if (control.closure === 'interrupted') {
        stored.loss = { key, podUid: stored.registration.podUid, reason: 'journal-unavailable' };
        stored.closure = { status: 'interrupted', persistedThrough: control.copied, reportedThrough: n, missingAfter: n === null || control.copied < n ? control.copied : null,
          missingThrough: n === null || control.copied < n ? n : null, tailUnknown: true, reason: stored.loss.reason, closedAt: control.now };
      }
      return StoredDevelopmentUsageSchema.parse(structuredClone(stored));
    },
  };
  const deps: DevelopmentEndingDeps = { owner: f.owner, store, session, clock };
  const request = async (reason: DevelopmentUsageDrainReason = 'cancelled') => store.request({ executionTaskId: f.child.id, expectedRegistration: (await f.owner.get(f.child.id))!.binding, reason, observedAt: control.now });
  return { ...f, store, session, deps, endingControl: control, drains, request };
}
