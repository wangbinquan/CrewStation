// RFC-034: native child snapshots must preserve exact usage, resume exclusion and incomplete evidence.
import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NativeUsageStep } from '@crewstation/contracts';
import { createNativeUsageCapture, unsupportedNativeUsageCapture } from '../drivers/usage/nativeCapture';
import { readNativeUsageSnapshot, type NativeUsageSnapshot } from '../drivers/usage/nativeSnapshot';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const at = 1790553600000;
function store() {
  const root = mkdtempSync(join(tmpdir(), 'cs-native-usage-')); roots.push(root);
  const path = join(root, 'opencode.db'), db = new Database(path);
  db.exec('CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT); CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT)');
  const session = (id: string, parent: string | null = null) => db.query('INSERT INTO session VALUES (?,?)').run(id, parent);
  const part = (id: string, sessionId: string, data: unknown, time = at) => {
    const message = 'message-' + id;
    db.query('INSERT INTO message VALUES (?,?,?)').run(message, sessionId, JSON.stringify({ role: 'assistant', providerID: 'provider', modelID: 'actual-model' }));
    db.query('INSERT INTO part VALUES (?,?,?,?,?)').run(id, sessionId, message, time, JSON.stringify(data));
  };
  return { db, path, session, part };
}
const numeric = (input: number | string = 10) => ({ type: 'step-finish', tokens: { input, output: 3, cache: { read: 2, write: 0 } } });
function step(id: string, input = '10'): NativeUsageStep {
  return { id, sessionId: 'root', parentSessionId: null, ancestors: [], occurredAt: new Date(at).toISOString(),
    usage: { input, output: '3', cacheRead: '2', cacheWrite: '0' }, actualModel: { provider: 'p', model: 'm', condition: null } };
}
const snapshot = (steps: NativeUsageStep[], fingerprint: string | null = 'fingerprint', issues: string[] = []): NativeUsageSnapshot => ({ steps, sessions: 1, fingerprint, issues });
function collector(read: (root: string) => NativeUsageSnapshot, resumeSessionId?: string) {
  let revision = 0;
  return createNativeUsageCapture({ lineageKey: 'stable-business-session', turn: 'turn', turnIndex: 0, resumeSessionId, nextRevision: () => ++revision }, read);
}

test('native snapshot walks root and descendants while excluding siblings and preserving exact numeric buckets', () => {
  const s = store(); s.session('root'); s.session('child', 'root'); s.session('leaf', 'child'); s.session('other');
  s.part('root-step', 'root', numeric('9007199254740993')); s.part('leaf-step', 'leaf', numeric(0)); s.part('other-step', 'other', numeric(999));
  const value = readNativeUsageSnapshot(s.path, 'root');
  expect(value.issues).toEqual([]); expect(value.sessions).toBe(3); expect(value.fingerprint).toBeString();
  expect(value.steps.map((s) => s.id)).toEqual(['root-step', 'leaf-step']);
  expect(value.steps[0]!.usage.input).toBe('9007199254740993');
  expect(value.steps[1]).toMatchObject({ sessionId: 'leaf', ancestors: ['root', 'child'], parentSessionId: 'child', usage: { input: '0' }, actualModel: { provider: 'provider', model: 'actual-model' } });
  expect(readNativeUsageSnapshot(s.path, 'root').fingerprint).toBe(value.fingerprint); s.db.close();
});

test('bounded scans and unfinished steps never produce a complete fingerprint', () => {
  const s = store(); s.session('root'); s.session('child', 'root'); s.part('done', 'root', numeric());
  for (const [options, issue] of [[{ maxSessions: 1 }, 'native-tree-budget'], [{ maxParts: 0 }, 'native-part-budget'], [{ maxSteps: 0 }, 'native-step-budget'], [{ budgetMs: 0 }, 'native-scan-budget']] as const) {
    const value = readNativeUsageSnapshot(s.path, 'root', options); expect(value.fingerprint).toBeNull(); expect(value.issues).toContain(issue);
  }
  s.part('unfinished', 'child', { type: 'step-start' });
  expect(readNativeUsageSnapshot(s.path, 'root').issues).toContain('native-step-unfinished');
  expect(readNativeUsageSnapshot(s.path, 'absent').fingerprint).toBeNull();
  expect(readNativeUsageSnapshot(null, 'root').issues).toContain('native-store-unavailable'); s.db.close();
});

test('missing model, time and buckets stay unknown without making an unusable baseline', () => {
  const s = store(); s.session('root'); s.part('step', 'root', { type: 'step-finish', tokens: { input: -1, output: 0 } }, -1);
  s.db.exec('DELETE FROM message');
  const value = readNativeUsageSnapshot(s.path, 'root');
  expect(value.fingerprint).toBeString(); expect(value.issues.sort()).toEqual(['native-model-unavailable', 'native-time-unavailable', 'native-token-bucket-unknown']);
  expect(value.steps[0]).toMatchObject({ occurredAt: null, actualModel: null, usage: { input: null, output: '0', cacheRead: null, cacheWrite: null } }); s.db.close();
});

test('pending precedes numeric frames and final completion follows all child chunks', () => {
  const c = collector(() => snapshot(Array.from({ length: 205 }, (_, i) => step('s' + i))));
  expect(c.begin(at).nativeProof?.state).toBe('pending'); expect(c.includesRecord('root', 'new')).toBe(true); c.observeSession('root');
  const frames = c.finish('root', at + 1);
  expect(frames.slice(0, -1).map((f) => f.measurements.length)).toEqual([100, 100, 5]);
  expect(frames.at(-1)!.nativeProof).toMatchObject({ state: 'complete', emitted: 205, steps: 205, priorRevisionGap: false });
  expect(frames[0]!.measurements[0]!.revision).toBe(1); expect(frames[2]!.measurements[4]!.revision).toBe(205);
});

test('resume excludes every old step and retains full before-after evidence with explicit prior revision gaps', () => {
  let value = snapshot([step('old')]); const c = collector(() => value, 'root'); c.begin(at);
  expect(c.includesRecord('root', 'old')).toBe(false); expect(c.includesRecord('root', 'new')).toBe(true);
  value = snapshot([step('old', '15'), step('new', '13')], 'after');
  const frames = c.finish('root', at + 1), numbers = frames.flatMap((f) => f.measurements);
  expect(numbers).toHaveLength(1); expect(numbers[0]!.usage.input).toBe('13');
  expect(frames.find((f) => f.nativeBaseline)?.nativeBaseline?.steps[0]).toEqual({ before: step('old'), after: step('old', '15'), afterObserved: true });
  expect(frames.at(-1)?.nativeProof).toMatchObject({ state: 'partial', priorRevisionGap: true, baselineSteps: 1 });
});

test('unvisited baseline steps are not treated as deletions and missing resume baselines admit no totals', () => {
  let value = snapshot([step('old')]); const c = collector(() => value, 'root'); c.begin(at);
  value = snapshot([], null, ['native-step-budget']);
  const frames = c.finish('root', at + 1);
  expect(frames.find((f) => f.nativeBaseline)?.nativeBaseline?.steps[0]).toMatchObject({ after: null, afterObserved: false });
  expect(frames.at(-1)?.nativeProof?.priorRevisionGap).toBe(false);
  const missing = collector(() => snapshot([step('new')], null, ['native-store-unavailable']), 'root'); missing.begin(at);
  expect(missing.includesRecord('root', 'new')).toBe(false);
  expect(missing.finish('root', at + 1).flatMap((f) => f.measurements)).toEqual([]);
});

test('root changes, absent roots, failed output and unsupported adapters cannot claim completion', () => {
  const c = collector(() => snapshot([step('new')])); c.begin(at); c.observeSession('root'); c.observeSession('other');
  expect(c.finish('root', at + 1).flatMap((f) => f.measurements)).toEqual([]);
  expect(c.finish('root', at + 1).at(-1)?.nativeProof?.issues).toContain('native-root-changed');
  const absent = collector(() => snapshot([])); absent.begin(at);
  expect(absent.finish(undefined, at).at(-1)?.nativeProof?.issues).toContain('native-root-unavailable');
  expect(absent.finish('root', at, ['native-output-incomplete']).at(-1)?.nativeProof?.state).toBe('partial');
  const unsupported = unsupportedNativeUsageCapture({ lineageKey: 'lineage', turn: 'turn', turnIndex: 0, nextRevision: () => 1 });
  expect(unsupported.begin(at).nativeProof?.state).toBe('unsupported'); expect(unsupported.finish('root', at)).toEqual([]);
});

test('native reader exceptions become partial capture and cannot escape into business execution', () => {
  const c = collector(() => { throw new Error('unreadable native store'); }, 'root');
  expect(c.begin(at).nativeProof?.state).toBe('pending');
  const final = c.finish('root', at + 1).at(-1)!.nativeProof!;
  expect(final.state).toBe('partial'); expect(final.issues).toContain('native-read-failed'); expect(final.issues).toContain('native-baseline-unavailable');
});
test('native timestamps outside the four-digit ISO contract remain unknown', () => {
  const s = store(); s.session('root'); s.part('future', 'root', numeric(), 253402300800000);
  const value = readNativeUsageSnapshot(s.path, 'root');
  expect(value.steps[0]!.occurredAt).toBeNull(); expect(value.issues).toContain('native-time-unavailable'); s.db.close();
});
