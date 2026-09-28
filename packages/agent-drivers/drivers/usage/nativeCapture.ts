import { jsonHash } from '@crewstation/kernel';
import { RunnerUsageCaptureSchema, type NativeUsageProof, type NativeUsageStep, type RunnerUsageCapture, type RunnerUsageMeasurement } from '@crewstation/contracts';
import type { NativeUsageSnapshot } from './nativeSnapshot';

export interface NativeCaptureInput { lineageKey: string; turn: string; turnIndex: number; resumeSessionId?: string; nextRevision: () => number }
export interface NativeUsageCapture {
  begin(at: number): RunnerUsageCapture;
  includesRecord(sessionId: string, partId: string): boolean;
  observeSession(sessionId: string): void;
  finish(root: string | undefined, at: number, issues?: string[]): RunnerUsageCapture[];
}
const equivalent = (before: NativeUsageStep, after: NativeUsageStep) => jsonHash(before) === jsonHash(after);
function measurement(input: NativeCaptureInput, step: NativeUsageStep, root: string, at: number): RunnerUsageMeasurement {
  return { recordId: `opencode:step:${jsonHash({ session: step.sessionId, id: step.id })}`, revision: input.nextRevision(),
    observedAt: new Date(at).toISOString(), occurredAt: step.occurredAt, actualModel: step.actualModel,
    adapterVersion: 'opencode-native-child/cs@1', reporting: 'delta', inclusion: 'self',
    scope: { root, session: step.sessionId, parentSession: step.parentSessionId, ancestors: step.ancestors, turn: input.turn, turnIndex: input.turnIndex, level: 'request' },
    coverage: Object.values(step.usage).every((value) => value !== null) ? 'complete' : 'partial', validity: 'valid',
    coveredThroughTurn: null, usage: step.usage, basis: { kind: 'invocation' } };
}
function proof(input: NativeCaptureInput, baseline: NativeUsageSnapshot | undefined, at: number, patch: Partial<NativeUsageProof>): NativeUsageProof {
  return { contract: 'opencode-child-steps-v1', lineageKey: input.lineageKey, turn: input.turn, turnIndex: input.turnIndex,
    state: 'pending', root: input.resumeSessionId ?? null, observedAt: new Date(at).toISOString(),
    baseline: { kind: input.resumeSessionId ? 'resume' : 'fresh', fingerprint: baseline?.fingerprint ?? null },
    fingerprint: null, sessions: 0, steps: 0, emitted: 0, baselineSteps: baseline?.steps.length ?? 0,
    priorRevisionGap: false, issues: [], ...patch };
}
const frame = (nativeProof: NativeUsageProof): RunnerUsageCapture => RunnerUsageCaptureSchema.parse({ version: 1, measurements: [], diagnostics: [], nativeProof });
function chunks<T>(items: T[], build: (rows: T[], offset: number) => RunnerUsageCapture): RunnerUsageCapture[] {
  const output: RunnerUsageCapture[] = [];
  for (let offset = 0; offset < items.length;) {
    let length = Math.min(100, items.length - offset), value = build(items.slice(offset, offset + length), offset);
    while (Buffer.byteLength(JSON.stringify(value)) > 192 * 1024 && length > 1) {
      length = Math.floor(length / 2); value = build(items.slice(offset, offset + length), offset);
    }
    output.push(value); offset += length;
  }
  return output;
}
/** One bounded collector per process turn. The final proof follows every numeric frame. */
export function createNativeUsageCapture(input: NativeCaptureInput, read: (root: string) => NativeUsageSnapshot): NativeUsageCapture {
  const snapshotOf = (root: string): NativeUsageSnapshot => {
    try { return read(root); }
    catch { return { steps: [], sessions: 0, fingerprint: null, issues: ['native-read-failed'] }; }
  };
  let baseline: NativeUsageSnapshot | undefined, begun = false, observedRoot: string | undefined;
  const observedIssues = new Set<string>();
  return {
    begin(at) {
      if (begun) throw new Error('Native capture already begun');
      begun = true;
      if (input.resumeSessionId) baseline = snapshotOf(input.resumeSessionId);
      return frame(proof(input, baseline, at, {}));
    },
    includesRecord(_session, partId) { return !input.resumeSessionId || Boolean(baseline?.fingerprint) && !baseline!.steps.some((step) => step.id === partId); },
    observeSession(session) {
      if (observedRoot && observedRoot !== session) observedIssues.add('native-root-changed');
      observedRoot ??= session;
    },
    finish(root, at, extra = []) {
      const session = root ?? input.resumeSessionId, snapshot = session ? snapshotOf(session) : undefined;
      const issues = new Set([...observedIssues, ...extra, ...(snapshot?.issues ?? ['native-root-unavailable'])]);
      if (!begun) issues.add('native-baseline-not-started');
      if (input.resumeSessionId && !baseline?.fingerprint) issues.add('native-baseline-unavailable');
      if (session && ((input.resumeSessionId && session !== input.resumeSessionId) || (observedRoot && session !== observedRoot))) issues.add('native-root-changed');
      const before = new Map((baseline?.steps ?? []).map((step) => [step.id, step]));
      const after = new Map((snapshot?.steps ?? []).map((step) => [step.id, step]));
      const history = [...before.values()].map((step) => ({ before: step, after: after.get(step.id) ?? null, afterObserved: after.has(step.id) || Boolean(snapshot?.fingerprint) }));
      const priorRevisionGap = history.some((row) => row.afterObserved && (!row.after || !equivalent(row.before, row.after)));
      if (priorRevisionGap) issues.add('native-prior-revision-gap');
      const attributable = begun && session && !issues.has('native-root-changed') && (!input.resumeSessionId || Boolean(baseline?.fingerprint));
      const rows = attributable ? (snapshot?.steps ?? []).filter((step) => !before.has(step.id)).map((step) => measurement(input, step, session, at)) : [];
      const candidates = chunks(rows, (measurements) => ({ version: 1, measurements, diagnostics: [] }));
      if (session) candidates.push(...chunks(history, (steps, offset) => ({ version: 1, measurements: [], diagnostics: [],
        nativeBaseline: { lineageKey: input.lineageKey, turn: input.turn, root: input.resumeSessionId ?? session, offset, steps } })));
      const output: RunnerUsageCapture[] = [];
      let bytes = 0, emitted = 0;
      for (const value of candidates) {
        bytes += Buffer.byteLength(JSON.stringify(value));
        if (bytes > 16 * 1024 * 1024) { issues.add('native-evidence-budget'); break; }
        emitted += value.measurements.length; output.push(value);
      }
      output.push(frame(proof(input, baseline, at, { state: snapshot?.fingerprint && !issues.size ? 'complete' : 'partial', root: session ?? null,
        fingerprint: snapshot?.fingerprint ?? null, sessions: snapshot?.sessions ?? 0, steps: snapshot?.steps.length ?? 0, emitted,
        priorRevisionGap, issues: [...issues] })));
      return output.map((value) => RunnerUsageCaptureSchema.parse(value));
    },
  };
}
export function unsupportedNativeUsageCapture(input: NativeCaptureInput): NativeUsageCapture {
  return { begin: (at) => frame(proof(input, undefined, at, { state: 'unsupported', issues: ['native-tree-unsupported'] })),
    includesRecord: () => true, observeSession: () => undefined, finish: () => [] };
}
