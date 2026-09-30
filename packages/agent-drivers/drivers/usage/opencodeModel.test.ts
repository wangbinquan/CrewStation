import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUsageObserver } from './capture';
import { createDevelopmentOpencodeUsageNormalizer, createOpencodeUsageNormalizer, opencodeUsageDatabasePath, readOpencodeUsageModel } from './opencodeModel';
import { DevelopmentNativeObserver } from './developmentNativeObserver';
import { parseEvent } from '../opencode/events';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function path() { const root = mkdtempSync(join(tmpdir(), 'cs-native-usage-')); roots.push(root); return join(root, 'native.db'); }
function seed(file: string, model = 'native-model') {
  const db = new Database(file);
  db.exec('CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT)');
  db.query('INSERT INTO message VALUES(?,?,?)').run('message', 'session', JSON.stringify({ role: 'assistant', providerID: 'native-provider', modelID: model }));
  db.query('INSERT INTO part VALUES(?,?,?,?)').run('step', 'message', 'session', JSON.stringify({ type: 'step-finish' }));
  db.close();
}
const raw = (input = 10) => ({ type: 'step_finish', sessionID: 'session', timestamp: 1000,
  part: { id: 'step', sessionID: 'session', messageID: 'message', tokens: { input, output: 3, cache: { read: 2, write: 0 } } } });
const event = (input = 10) => parseEvent(JSON.stringify(raw(input)))!;

test('uses the final child environment including explicit relative DB, without borrowing the parent HOME', () => {
  expect(opencodeUsageDatabasePath({ HOME: '/child' })).toBe('/child/.local/share/opencode/opencode.db');
  expect(opencodeUsageDatabasePath({ HOME: '/child', XDG_DATA_HOME: '/private/data', OPENCODE_DB: 'custom.db' })).toBe('/private/data/opencode/custom.db');
  expect(opencodeUsageDatabasePath({ OPENCODE_DB: '/exact/native.db' })).toBe('/exact/native.db');
  expect(opencodeUsageDatabasePath({ HOME: '/child', XDG_DATA_HOME: 'relative' })).toBe('/child/.local/share/opencode/opencode.db');
  expect(opencodeUsageDatabasePath({ HOME: '/child', OPENCODE_DB: ':memory:' })).toBeNull();
  expect(opencodeUsageDatabasePath({ OPENCODE_TEST_HOME: '/not-the-xdg-home' })).toBeNull();
});

test('binds only the observed part/session/message to an assistant actual route', () => {
  const file = path(); seed(file);
  expect(readOpencodeUsageModel(file, raw(), 'session')).toEqual({ provider: 'native-provider', model: 'native-model', condition: null });
  for (const changed of [{ ...raw(), sessionID: 'different' }, { ...raw(), part: { ...raw().part, messageID: 'different' } },
    { ...raw(), part: { ...raw().part, sessionID: 'different' } }, { ...raw(), part: { ...raw().part, id: 'different' } }])
    expect(readOpencodeUsageModel(file, changed, 'session')).toBeNull();
  const db = new Database(file);
  for (const info of [{ role: 'user', model: { providerID: 'configured', modelID: 'configured' } }, { role: 'assistant', modelID: 'missing-provider' }, []]) {
    db.query('UPDATE message SET data=?').run(JSON.stringify(info));
    expect(readOpencodeUsageModel(file, raw(), 'session')).toBeNull();
  }
  db.query('UPDATE message SET data=?').run('malformed');
  expect(readOpencodeUsageModel(file, raw(), 'session')).toBeNull(); db.close();
  expect(readOpencodeUsageModel(null, raw(), 'session')).toBeNull();
});

test('late DB availability emits one numeric-only revision and preserves the original turn', () => {
  const file = path(), observer = createUsageObserver(createOpencodeUsageNormalizer({ OPENCODE_DB: file }), 'agent');
  const first = observer.beginTurn()(event(), 1000)!;
  expect(first).toMatchObject({ diagnostics: ['native-model-unavailable'], measurements: [{ actualModel: null, revision: 1 }] });
  observer.beginTurn();
  expect(observer.retryModels(1100)).toEqual([]);
  seed(file);
  const corrections = observer.retryModels(1200), next = corrections[0]!.measurements[0]!;
  expect(corrections).toHaveLength(1); expect(corrections[0]!.diagnostics).toEqual([]);
  expect(next).toMatchObject({ actualModel: { provider: 'native-provider', model: 'native-model' }, recordId: first.measurements[0]!.recordId,
    usage: first.measurements[0]!.usage, scope: first.measurements[0]!.scope, occurredAt: first.measurements[0]!.occurredAt });
  expect(next.revision).toBeGreaterThan(first.measurements[0]!.revision);
  expect(observer.retryModels(1300)).toEqual([]);
});

test('a later unavailable native read retains proven model while numeric revisions continue', () => {
  const file = path(); seed(file);
  const observer = createUsageObserver(createOpencodeUsageNormalizer({ OPENCODE_DB: file }), 'agent'), capture = observer.beginTurn();
  const first = capture(event(), 1000)!; rmSync(file);
  const next = capture(event(20), 1100)!;
  expect(next.measurements[0]!.actualModel).toEqual(first.measurements[0]!.actualModel);
  expect(next.measurements[0]!.usage.input).toBe('20'); expect(next.diagnostics).toEqual([]);
  seed(file, 'changed-model');
  expect(capture(event(21), 1200)!.measurements[0]!.actualModel?.model).toBe('changed-model');
});

test('retry queue and elapsed budget produce explicit gaps while preserving original Token evidence', () => {
  const observer = createUsageObserver(createOpencodeUsageNormalizer({ OPENCODE_DB: path() }), 'agent'), capture = observer.beginTurn();
  let last;
  for (let index = 0; index < 201; index++) last = capture(parseEvent(JSON.stringify({ ...raw(), part: { ...raw().part, id: 'step-' + index } }))!, 1000);
  expect(last!.diagnostics).toContain('native-model-retry-capacity');
  expect(last!.measurements[0]!.usage.input).toBe('10');
  expect(observer.retryModels(1200, 0)).toEqual([{ version: 1, measurements: [], diagnostics: ['native-model-retry-budget'] }]);
});

test('development model evidence never survives native file loss or replacement while stdout Tokens remain known', () => {
  const file = path(); seed(file, 'original-model');
  const source = new DevelopmentNativeObserver(file), observer = createUsageObserver(createDevelopmentOpencodeUsageNormalizer(source), 'agent'), capture = observer.beginTurn();
  expect(capture(event(), 1000)?.measurements[0]?.actualModel?.model).toBe('original-model');
  rmSync(file); const unavailable = capture(event(15), 1100)!;
  expect(unavailable.measurements[0]).toMatchObject({ actualModel: null, usage: { input: '15' } }); expect(unavailable.diagnostics).toContain('native-model-unavailable');
  seed(file, 'replacement-model'); const changed = capture(event(16), 1200)!;
  expect(changed.measurements[0]).toMatchObject({ actualModel: null, usage: { input: '16' } }); expect(source.issues()).toContain('native-source-changed');
});
test('development cache can retain a proven assistant only in the same currently observed native store', () => {
  const file = path(); seed(file); const observer = createUsageObserver(createDevelopmentOpencodeUsageNormalizer(new DevelopmentNativeObserver(file)), 'agent'), capture = observer.beginTurn();
  const first = capture(event(), 1000)!; const db = new Database(file); db.exec('DELETE FROM message'); db.close();
  expect(capture(event(15), 1100)?.measurements[0]?.actualModel).toEqual(first.measurements[0]?.actualModel);
  const replacement = path(); seed(replacement, 'different-model'); renameSync(replacement, file);
  expect(capture(event(16), 1200)?.measurements[0]?.actualModel).toBeNull();
});
test('pending corrections keep their original turn and source when a later turn selects a different DB', () => {
  const original = path(), next = path(); seed(next, 'next-model');
  const observer = createUsageObserver(createDevelopmentOpencodeUsageNormalizer(new DevelopmentNativeObserver(original)), 'agent'), first = observer.beginTurn()(event(), 1000)!;
  observer.setNormalizer(createDevelopmentOpencodeUsageNormalizer(new DevelopmentNativeObserver(next))); observer.beginTurn();
  expect(observer.retryModels(1100)).toEqual([]); seed(original, 'original-model');
  const correction = observer.retryModels(1200)[0]?.measurements[0];
  expect(correction?.actualModel?.model).toBe('original-model'); expect(correction?.scope).toEqual(first.measurements[0]?.scope); expect(correction?.recordId).toBe(first.measurements[0]?.recordId);
  expect(correction?.usage.input).toBe('10');
});
