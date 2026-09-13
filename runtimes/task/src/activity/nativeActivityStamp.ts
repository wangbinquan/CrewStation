import type { NativeActivityEvent, NativeActivitySignal } from '@crewstation/contracts';

export interface NativeActivityOptions {
  agentId: string;
  terminalId: string;
  runnerId: string;
  emit(activity: NativeActivityEvent): void;
  dependencyDir?: string;
  leaseMs?: number;
}

export function createActivityStamp(options: NativeActivityOptions): (signal: NativeActivitySignal) => void {
  let sequence = 0, ordinal = 0;
  const turns = new Map<string, number>();
  return (signal) => {
    if (signal.kind === 'turn-started' && signal.turnId && !turns.has(signal.turnId)) {
      turns.set(signal.turnId, ++ordinal);
      if (turns.size > 256) turns.delete(turns.keys().next().value!);
    }
    const seq = ++sequence;
    options.emit({ agentId: options.agentId, terminalId: options.terminalId, runnerId: options.runnerId, eventId: crypto.randomUUID(), seq, turnOrdinal: signal.turnId ? turns.get(signal.turnId) ?? 0 : 0, signal });
  };
}
