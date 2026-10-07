import { createHash, randomUUID } from 'node:crypto';
import { sameDevelopmentNativeStore, type DevelopmentNativePreparation } from '@crewstation/contracts';
import type { DevelopmentNativePagedCapture, DevelopmentNativeProducer } from '../../contract/developmentNativeProducer';
import { DevelopmentNativeObserver } from './developmentNativeObserver';
import { opencodeUsageDatabasePath } from './opencodeModel';
import type { NativeUsagePassReader } from './nativeUsagePassTypes';
import { openNativeUsagePass } from './nativeUsagePass';
import { persistNativeUsagePass } from './persistNativeUsagePass';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Bootstrap is already reaped/drained. This checkpoint commits before the actual model spawn. */
export async function beginDevelopmentNativePagedCapture(input: {
  readonly producer: DevelopmentNativeProducer;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly turn: string;
  readonly turnIndex: number;
  readonly resumeSessionId?: string;
}): Promise<DevelopmentNativePagedCapture> {
  const observer = new DevelopmentNativeObserver(opencodeUsageDatabasePath(input.env));
  const store = observer.inspect(), observedAt = new Date().toISOString();
  if (store.state !== 'observed' || !observer.plannedPathDigest || observer.issues().length)
    throw new Error('Native usage source was not actually initialized by the selected runtime');
  input.producer.beginTurn({ turn: input.turn, turnIndex: input.turnIndex,
    resumeSessionId: input.resumeSessionId ?? null, store, observedAt, plannedPathDigest: observer.plannedPathDigest });
  const pass = async (rootSessionId: string, phase: 'baseline' | 'final') => {
    const current = observer.inspect();
    if (observer.changed() || observer.issues().length || !sameDevelopmentNativeStore(store, current))
      throw new Error('Original native source changed during the actual turn');
    const preparation: DevelopmentNativePreparation = { turn: input.turn, turnIndex: input.turnIndex,
      rootSessionId, store, observedAt };
    let opened: NativeUsagePassReader | undefined;
    const read = observer.read((path) => opened = openNativeUsagePass(path, { passId: randomUUID(),
      turn: input.turn, nativeSource: 'opencode:' + store.actualPathDigest, sourceGeneration: hash(store),
      rootSessionId, lineageKey: input.producer.lineageKey, epoch: store.sourceEpoch, phase }));
    const reader = read.value;
    if (!reader || observer.changed() || !sameDevelopmentNativeStore(store, read.store)) {
      opened?.close(); throw new Error('Original native pass could not retain its source');
    }
    try {
      if (reader.rootParentSessionId !== null) throw new Error('Announced native session is not an actual original root');
      const owner = input.producer.owner(preparation, reader.rootCreatedAt);
      const ack = await persistNativeUsagePass(reader, owner);
      if (!ack.eof) throw new Error('Original native pass did not reach actual EOF');
    } finally { reader.close(); }
  };
  try { if (input.resumeSessionId !== undefined) await pass(input.resumeSessionId, 'baseline'); }
  catch (error) { input.producer.interrupted(); throw error; }
  let finished = false;
  return {
    async finish(root, issues) {
      if (finished) return;
      finished = true;
      try {
        if (issues.length || !root) throw new Error('Original native process did not provide a reaped, drained root');
        if (input.resumeSessionId !== undefined && root !== input.resumeSessionId)
          throw new Error('Actual native process changed its prepared resume root');
        await pass(root, 'final');
      } catch (error) { input.producer.interrupted(); throw error; }
    },
  };
}
