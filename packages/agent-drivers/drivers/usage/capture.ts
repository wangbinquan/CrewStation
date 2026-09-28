import { RunnerUsageCaptureSchema, type RunnerUsageCapture, type RunnerUsageMeasurement } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { parseJsonObjectLine, type NormalizedEvent } from '../../contract/normalizedEvent';

export type UsageObject = Record<string, unknown>;
export const object = (value: unknown): UsageObject | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UsageObject : undefined;
export const identifier = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : undefined;
export const buckets = ['input', 'cacheRead', 'cacheWrite', 'output'] as const;
export interface UsageContext { sessionId: string; turnId: string; turnIndex: number; revision: number; observedAt: string; resumeSessionId?: string }
export type UsageNormalizer = (raw: UsageObject, context: UsageContext, diagnostics: string[]) => RunnerUsageMeasurement[];
export type UsageCapture = (event: NormalizedEvent, at: number) => RunnerUsageCapture | undefined;

function counter(value: unknown, diagnostics: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^(0|[1-9]\d{0,59})$/.test(value)) return value;
  diagnostics.push('invalid-counter'); return null;
}
export function readUsage(values: Record<typeof buckets[number], unknown>, diagnostics: string[]): RunnerUsageMeasurement['usage'] {
  return { input: counter(values.input, diagnostics), cacheRead: counter(values.cacheRead, diagnostics), cacheWrite: counter(values.cacheWrite, diagnostics), output: counter(values.output, diagnostics) };
}
export function common(raw: UsageObject, context: UsageContext) {
  const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : NaN;
  return { revision: context.revision, observedAt: context.observedAt,
    occurredAt: Number.isFinite(timestamp) && Math.abs(timestamp) <= 8640000000000000 ? new Date(timestamp).toISOString() : null,
    actualModel: null, coveredThroughTurn: null };
}
export function scope(context: UsageContext, level: NonNullable<RunnerUsageMeasurement['scope']>['level']): NonNullable<RunnerUsageMeasurement['scope']> {
  return { root: context.sessionId, session: context.sessionId, parentSession: null, ancestors: [],
    turn: level === 'tree-total' ? 'session-origin' : context.turnId, turnIndex: level === 'tree-total' ? 0 : context.turnIndex, level };
}

interface SeenUsage { turnIndex: number; turnId: string; fingerprint: string; nativeFingerprint: string; pending: boolean }
interface PendingUsage { event: NormalizedEvent; seen: SeenUsage }
const MODEL_RETRY_LIMIT = 200;
function contentFingerprint(capture: RunnerUsageCapture): string {
  return jsonHash({ ...capture, measurements: capture.measurements.map(({ revision: _revision, observedAt: _observed, ...row }) => row) });
}

/** One observer per accepted Agent; revisions and native turn attribution survive process restarts. */
export function createUsageObserver(normalize: UsageNormalizer, agentId: string, resumeSessionId?: string) {
  let turn = 0, revision = 0;
  let current: { turnIndex: number; turnId: string } | undefined;
  const contexts = new Map<string, SeenUsage>(), pending = new Map<string, PendingUsage>();
  const capture = (event: NormalizedEvent, at: number, turnContext: { turnIndex: number; turnId: string }, retry = false): RunnerUsageCapture | undefined => {
    const raw = parseJsonObjectLine(event.rawLine);
    if (!raw || !event.businessUsage) return undefined;
    const sessionId = identifier(event.sessionId), nativeId = identifier(raw.uuid ?? object(raw.part)?.id);
    if (!sessionId || !nativeId) return { version: 1, measurements: [], diagnostics: [!sessionId ? 'missing-native-session' : 'missing-measurement-identity'] };
    const key = jsonHash({ sessionId, nativeId }), nativeFingerprint = jsonHash(raw), before = contexts.get(key);
    if (!retry && before?.nativeFingerprint === nativeFingerprint && !before.pending) return undefined;
    const context = { turnIndex: before?.turnIndex ?? turnContext.turnIndex, turnId: before?.turnId ?? turnContext.turnId };
    const diagnostics: string[] = [];
    try {
      const measurements = normalize(raw, { ...context, sessionId, revision: ++revision, observedAt: new Date(at).toISOString(), resumeSessionId }, diagnostics);
      const needsModel = diagnostics.includes('native-model-unavailable');
      if (needsModel && !pending.has(key) && pending.size >= MODEL_RETRY_LIMIT) diagnostics.push('native-model-retry-capacity');
      const result = RunnerUsageCaptureSchema.parse({ version: 1, measurements, diagnostics: [...new Set(diagnostics)] });
      const fingerprint = contentFingerprint(result), seen = { ...context, nativeFingerprint, fingerprint, pending: needsModel };
      contexts.set(key, seen);
      if (!needsModel) pending.delete(key);
      else if (pending.has(key) || pending.size < MODEL_RETRY_LIMIT) pending.set(key, { event, seen });
      return before?.fingerprint === fingerprint ? undefined : result;
    } catch { return { version: 1, measurements: [], diagnostics: ['usage-normalization-failed'] }; }
  };
  return {
    beginTurn(includesRecord?: (sessionId: string, nativeId: string) => boolean): UsageCapture {
      const turnIndex = turn++, turnId = jsonHash({ agentId, turnIndex });
      current = { turnIndex, turnId };
      return (event, at) => {
        const raw = parseJsonObjectLine(event.rawLine), nativeId = identifier(raw?.uuid ?? object(raw?.part)?.id);
        if (includesRecord && event.sessionId && nativeId && !includesRecord(event.sessionId, nativeId)) return undefined;
        return capture(event, at, { turnIndex, turnId });
      };
    },
    currentTurn() { if (!current) throw new Error('Usage turn has not begun'); return current; },
    nextRevision() { return ++revision; },
    /** Numeric-only corrections. The caller must not re-emit legacy BusinessUsage or lifecycle events. */
    retryModels(at: number, budgetMs = 50): RunnerUsageCapture[] {
      const rows: RunnerUsageCapture[] = [], deadline = performance.now() + budgetMs;
      for (const { event, seen } of [...pending.values()]) {
        if (performance.now() >= deadline) { rows.push({ version: 1, measurements: [], diagnostics: ['native-model-retry-budget'] }); break; }
        const result = capture(event, at, seen, true);
        if (result) rows.push(result);
      }
      return rows;
    },
  };
}
