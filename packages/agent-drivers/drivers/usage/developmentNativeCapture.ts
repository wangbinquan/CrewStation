import { DevelopmentRunnerUsageCaptureSchema, sameDevelopmentNativeStore, type DevelopmentNativeSource, type DevelopmentNativeStore, type DevelopmentRunnerUsageCapture, type RunnerUsageCapture } from '@crewstation/contracts';
import { DevelopmentNativeObserver } from './developmentNativeObserver';
import { createNativeUsageCapture, unsupportedNativeUsageCapture, type NativeCaptureInput, type NativeUsageCapture } from './nativeCapture';
import { createDevelopmentOpencodeUsageNormalizer, opencodeUsageDatabasePath } from './opencodeModel';
import { readNativeSnapshotWithinOrder } from './orderedNativeSnapshot';
import type { NativeUsageSnapshot } from './nativeSnapshot';

function sourceFrame(frame: RunnerUsageCapture, source: DevelopmentNativeSource): DevelopmentRunnerUsageCapture {
  const proof = frame.nativeProof!;
  const interrupted = source.stage === 'finish' && (source.finalStore?.state !== 'observed' || !['same', 'new'].includes(source.continuity) || source.issues.length > 0);
  const issues = [...new Set([...proof.issues, ...source.issues])];
  return DevelopmentRunnerUsageCaptureSchema.parse({ ...frame, nativeSource: source, nativeProof: { ...proof,
    state: proof.state === 'complete' && interrupted ? 'partial' : proof.state,
    issues: issues.length > 30 ? [...issues.slice(0, 29), 'native-evidence-budget'] : issues } });
}
function metadata(input: NativeCaptureInput, stage: DevelopmentNativeSource['stage'], at: number, observer: DevelopmentNativeObserver, beginStore: DevelopmentNativeStore): DevelopmentNativeSource {
  const finalStore = stage === 'finish' ? observer.current() : null;
  const continuity = stage === 'begin' ? 'unverified' : observer.changed() ? 'changed'
    : sameDevelopmentNativeStore(beginStore, finalStore) ? 'same'
    : !input.resumeSessionId && beginStore.state === 'pending' && finalStore?.state === 'observed' ? 'new' : 'unverified';
  return { version: 1, stage, lineageKey: input.lineageKey, turn: input.turn, turnIndex: input.turnIndex, observedAt: new Date(at).toISOString(),
    plannedPathDigest: observer.plannedPathDigest, scope: (finalStore ?? beginStore).state === 'observed' ? 'execution-local' : 'unverified',
    beginStore, finalStore, continuity, issues: observer.issues() };
}
/** Snapshot and actual-model reads use one observer from this turn's final spawn environment. */
export function createDevelopmentNativeUsageCapture(input: NativeCaptureInput, env: Readonly<Record<string, string | undefined>>): NativeUsageCapture {
  const observer = new DevelopmentNativeObserver(opencodeUsageDatabasePath(env));
  const read = (root: string): NativeUsageSnapshot => observer.read((path, sidecar) => readNativeSnapshotWithinOrder(sidecar, path, root)).value
    ?? { steps: [], sessions: 0, fingerprint: null, issues: ['native-store-unavailable', ...observer.issues()] };
  const capture = createNativeUsageCapture(input, read);
  let beginStore: DevelopmentNativeStore = { state: 'unavailable' };
  return {
    normalizeUsage: createDevelopmentOpencodeUsageNormalizer(observer),
    begin(at) {
      observer.inspect(); const frame = capture.begin(at); beginStore = observer.current();
      return sourceFrame(frame, metadata(input, 'begin', at, observer, beginStore));
    },
    includesRecord: (session, part) => capture.includesRecord(session, part),
    observeSession: (session) => capture.observeSession(session),
    finish(root, at, issues) {
      const frames = capture.finish(root, at, issues); observer.inspect();
      return frames.map((frame) => frame.nativeProof ? sourceFrame(frame, metadata(input, 'finish', at, observer, beginStore)) : frame);
    },
  };
}
export function unsupportedDevelopmentNativeUsageCapture(input: NativeCaptureInput): NativeUsageCapture {
  const capture = unsupportedNativeUsageCapture(input);
  const frame = (stage: DevelopmentNativeSource['stage'], at: number) => sourceFrame(capture.begin(at), {
    version: 1, stage, lineageKey: input.lineageKey, turn: input.turn, turnIndex: input.turnIndex, observedAt: new Date(at).toISOString(), plannedPathDigest: null,
    scope: 'unverified', beginStore: { state: 'unavailable' }, finalStore: stage === 'finish' ? { state: 'unavailable' } : null,
    continuity: 'unverified', issues: ['native-source-unsupported'],
  });
  return { begin: (at) => frame('begin', at), includesRecord: () => true, observeSession: () => undefined, finish: (_root, at) => [frame('finish', at)] };
}
