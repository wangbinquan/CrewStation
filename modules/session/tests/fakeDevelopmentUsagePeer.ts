import type { DevelopmentUsageEvent, DevelopmentUsageInterruption, DevelopmentUsageKey, DevelopmentUsageReceipt, DevelopmentUsageRegistration, RunnerUsageCapture } from '@crewstation/contracts';
import { developmentReceipt } from './developmentUsageFixtures';

/** Minimal controllable protocol fixture; production SQLite behavior is exercised separately. */
export function fakeDevelopmentUsagePeer(registration: DevelopmentUsageRegistration) {
  let receipt: DevelopmentUsageReceipt | null = null, events: DevelopmentUsageEvent[] = [];
  return {
    reserve: () => { receipt = developmentReceipt(registration); return { created: true, receipt }; },
    info: (_key?: DevelopmentUsageKey) => ({ version: 1 as const, runtimeTaskId: registration.runtimeTaskId, journalId: registration.key.journalId, incarnation: registration.key.incarnation, podUid: registration.podUid, receipt }),
    running: (_key: DevelopmentUsageKey) => {},
    capture: (_key: DevelopmentUsageKey, capture: RunnerUsageCapture, occurredAt: string) => { const sequence = receipt!.lastSequence + 1; events.push({ sequence, capture, occurredAt }); receipt = { ...receipt!, lastSequence: sequence }; },
    finish: (_key: DevelopmentUsageKey, result: DevelopmentUsageReceipt['result']) => { receipt = { ...receipt!, phase: 'finished', result, finalThrough: receipt!.interruption ? null : receipt!.lastSequence }; },
    interrupt: (_id: string, interruption: DevelopmentUsageInterruption) => { receipt = { ...receipt!, interruption, finalThrough: null }; },
    read: (key: DevelopmentUsageKey, after: number, limit = 5) => { const page = events.filter((event) => event.sequence > after).slice(0, limit); return { key, after, through: after + page.length, events: page }; },
    acknowledge: (_key: DevelopmentUsageKey, through: number) => { events = events.filter((event) => event.sequence > through); receipt = { ...receipt!, acknowledgedSequence: through }; return receipt; },
  };
}
