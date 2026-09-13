import type { NativeActivityEvent, NativeActivityKind } from '@crewstation/contracts';
import { NativeActivityEventSchema } from '@crewstation/contracts';

export function nativeActivityInbox() {
  const events: NativeActivityEvent[] = [];
  const waiters = new Set<() => void>();
  return {
    events,
    emit(event: NativeActivityEvent) { events.push(NativeActivityEventSchema.parse(event)); for (const notify of waiters) notify(); },
    wait(kind: NativeActivityKind, ordinal?: number): Promise<NativeActivityEvent> {
      return new Promise((resolve, reject) => {
        const done = () => {
          const event = events.find((entry) => entry.signal.kind === kind && (ordinal === undefined || entry.turnOrdinal === ordinal));
          if (!event) return;
          clearTimeout(timer); waiters.delete(done); resolve(event);
        };
        const timer = setTimeout(() => { waiters.delete(done); reject(new Error(`Missing ${kind}/${ordinal}; observed ${events.map((event) => `${event.turnOrdinal}:${event.signal.kind}:${event.signal.reason ?? ''}`).join(',')}`)); }, 20000);
        waiters.add(done); done();
      });
    },
  };
}
