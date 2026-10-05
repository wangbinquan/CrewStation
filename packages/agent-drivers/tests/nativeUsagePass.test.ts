// RFC-034: real original native SQLite must exceed every existing population bound. Reader foundation only;
// owner persistence, emission allocation and production switching are separate required gates.
import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openNativeUsagePass } from '../drivers/usage/nativeUsagePass'
import { readNativeUsageSnapshot } from '../drivers/usage/nativeSnapshot'
import type {
  NativeUsagePassIdentity,
  NativeUsagePassPage,
  NativeUsagePassReader,
} from '../drivers/usage/nativeUsagePassTypes'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
})
const identity: NativeUsagePassIdentity = {
  passId: 'owner-pass',
  turn: 'accepted-turn',
  nativeSource: 'actual-native-store',
  sourceGeneration: 'owner-generation',
  rootSessionId: 'root',
  lineageKey: 'original-lineage',
  epoch: 'owner-epoch',
  phase: 'baseline',
}
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'cs-native-pass-')),
    path = join(folder, 'native.db')
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }))
  const db = new Database(path)
  cleanup.push(() => db.close())
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE session (id TEXT PRIMARY KEY,parent_id TEXT); CREATE INDEX session_parent ON session(parent_id,id);
    CREATE TABLE message (id TEXT PRIMARY KEY,session_id TEXT,data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT);
    CREATE INDEX part_session ON part(session_id,id);`)
  const session = (id: string, parent: string | null = null) =>
    db.query('INSERT INTO session VALUES (?,?)').run(id, parent)
  const part = (id: string, sessionId: string, kind: string, input: unknown = 11) => {
    const messageId = 'message-' + id
    db.query('INSERT INTO message VALUES (?,?,?)').run(
      messageId,
      sessionId,
      JSON.stringify({ role: 'assistant', providerID: 'provider', modelID: 'model' }),
    )
    db.query('INSERT INTO part VALUES (?,?,?,?,?)').run(
      id,
      sessionId,
      messageId,
      1234,
      JSON.stringify({
        type: kind,
        tokens: { input, output: 3, reasoning: 2, cache: { read: 7, write: 13 } },
        text: 'body-does-not-leave-native-db',
      }),
    )
  }
  session('root')
  let pass = 0
  const open = (pageRows = 200, pageBytes = 256 * 1024) => {
    const reader = openNativeUsagePass(
      path,
      { ...identity, passId: identity.passId + String(++pass) },
      { pageRows, pageBytes },
    )
    cleanup.push(() => reader.close())
    return reader
  }
  return { path, db, session, part, open }
}
function consume(reader: NativeUsagePassReader, visit: (page: NativeUsagePassPage) => void) {
  let cursor: string | null = reader.initialCursor,
    last: NativeUsagePassPage | undefined
  while (cursor !== null) {
    const page = reader.next(cursor)
    visit(page)
    expect(page.cursor).toBe(cursor)
    if (page.nextCursor !== null) {
      expect(page.scanPositionAfter).not.toBe(page.scanPositionBefore)
      expect(BigInt(page.scannedRawRows)).toBeGreaterThan(0n)
      expect(page.eof).toBeNull()
    }
    reader.acknowledge(page.ordinal, page.payloadDigest)
    cursor = page.nextCursor
    last = page
  }
  return last!
}

test('native pass reaches every original part, 10001 steps, 1025 sessions and depth 80 without a subtotal', () => {
  const f = fixture()
  f.db.transaction(() => {
    for (let n = 0; n < 50001; n++) f.part('a-' + String(n).padStart(6, '0'), 'root', 'text')
    for (let n = 0; n < 10001; n++)
      f.part('z-' + String(n).padStart(6, '0'), 'root', 'step-finish', String(n + 1))
    for (let n = 1; n <= 1024; n++)
      f.session(
        'child-' + String(n).padStart(4, '0'),
        n <= 80 ? (n === 1 ? 'root' : 'child-' + String(n - 1).padStart(4, '0')) : 'root',
      )
    f.session('unrelated')
    f.part('outside', 'unrelated', 'step-finish', 999999)
  })()
  let seen = 0n,
    sum = 0n,
    nonNumericContinuations = 0,
    lastOrdinal = -1n
  const ids = new Set<string>(),
    sessions = new Map<string, string | null>()
  const last = consume(f.open(), (page) => {
    expect(BigInt(page.ordinal)).toBe(lastOrdinal + 1n)
    lastOrdinal = BigInt(page.ordinal)
    if (!page.steps.length && page.nextCursor !== null) nonNumericContinuations++
    for (const session of page.sessions) {
      expect(sessions.has(session.id)).toBe(false)
      sessions.set(session.id, session.parentSessionId)
    }
    for (const step of page.steps) {
      expect(ids.has(step.stepId)).toBe(false)
      ids.add(step.stepId)
      seen++
      sum += BigInt(step.usage.input!)
      expect(step.usage).toEqual({
        input: step.usage.input,
        output: '5',
        cacheRead: '7',
        cacheWrite: '13',
      })
      expect(step.model).toEqual({ provider: 'provider', id: 'model' })
      expect(step.occurredAt).toBe(1234)
      expect(JSON.stringify(step)).not.toContain('body-does-not-leave-native-db')
    }
  })
  expect(seen).toBe(10001n)
  expect(sum).toBe((10001n * 10002n) / 2n)
  expect(sessions.size).toBe(1025)
  expect(sessions.get('child-0080')).toBe('child-0079')
  expect(sessions.has('unrelated')).toBe(false)
  expect(nonNumericContinuations).toBeGreaterThan(100)
  expect(last.eof?.counts).toEqual({ sessions: '1025', parts: '60002', steps: '10001' })
  expect(last.issues).toEqual([])
  expect(last.eof?.fingerprint).toMatch(/^[a-f0-9]{64}$/)
}, 60000)

test('one frozen page requires owner ACK, retries exact bytes, and keeps the original native snapshot', () => {
  const f = fixture()
  f.part('before', 'root', 'step-finish')
  const reader = f.open(1),
    first = reader.next(reader.initialCursor)
  expect(first.nextCursor).not.toBeNull()
  expect(first.eof).toBeNull()
  expect(reader.next(reader.initialCursor)).toEqual(first)
  expect(() => reader.next(first.nextCursor!)).toThrow('awaits original owner ACK')
  expect(() => reader.acknowledge(first.ordinal, 'wrong')).toThrow('changed frozen page')
  const changed = structuredClone(first) as unknown as { sessions: Array<{ id: string }> }
  changed.sessions[0]!.id = 'changed'
  expect(reader.next(reader.initialCursor)).toEqual(first)
  f.part('later', 'root', 'step-finish', 9000)
  reader.acknowledge(first.ordinal, first.payloadDigest)
  const rest: string[] = []
  const final = consume(
    {
      identity: reader.identity,
      initialCursor: first.nextCursor!,
      rootCreatedAt: reader.rootCreatedAt,
      next: reader.next,
      acknowledge: reader.acknowledge,
      close: reader.close,
    },
    (page) => {
      rest.push(...page.steps.map((s) => s.stepId))
    },
  )
  expect(rest).toEqual(['before'])
  expect(final.eof?.counts.parts).toBe('1')
  expect(() => reader.next(first.cursor)).toThrow('snapshot closed')
  const newer: string[] = []
  consume(f.open(), (page) => newer.push(...page.steps.map((s) => s.stepId)))
  expect(newer).toEqual(['before', 'later'])
})

test('the first part range includes malformed empty original keys instead of silently skipping them', () => {
  const f = fixture()
  f.part('', 'root', 'step-finish')
  f.part('later', 'root', 'step-finish')
  const reader = f.open(1)
  const first = reader.next(reader.initialCursor)
  reader.acknowledge(first.ordinal, first.payloadDigest)
  expect(() => reader.next(first.nextCursor!)).toThrow('Native part cursor unavailable')
})

test('the first child range includes malformed empty session keys and cannot seal a complete subset', () => {
  const f = fixture()
  f.session('', 'root')
  const reader = f.open(1)
  const first = reader.next(reader.initialCursor)
  reader.acknowledge(first.ordinal, first.payloadDigest)
  expect(() => reader.next(first.nextCursor!)).toThrow('Native child cursor unavailable')
})

test('packet byte bounds and scan page size preserve the same EOF fingerprint and exact four buckets', () => {
  const f = fixture()
  for (let n = 0; n < 101; n++)
    f.part(String(n).padStart(4, '0'), 'root', 'step-finish', String(n + 1))
  const run = (rows: number, bytes: number) => {
    let sum = 0n,
      steps = 0
    const final = consume(f.open(rows, bytes), (page) => {
      const payload = page.sessions
        .map((s) => JSON.stringify(s))
        .concat(page.steps.map((s) => JSON.stringify(s)))
      expect(payload.reduce((n, s) => n + Buffer.byteLength(s), 0)).toBeLessThanOrEqual(bytes)
      for (const step of page.steps) {
        sum += BigInt(step.usage.input!)
        steps++
      }
    })
    return { sum, steps, eof: final.eof }
  }
  expect(run(2, 1024)).toEqual(run(1000, 1024))
})

test('unavailable roots, interrupted passes, malformed originals and tree cycles cannot claim ready', () => {
  const f = fixture()
  expect(() => openNativeUsagePass(f.path, { ...identity, rootSessionId: 'missing' })).toThrow(
    'root unavailable',
  )
  f.session('child', 'root')
  f.db.query('UPDATE session SET parent_id=? WHERE id=?').run('child', 'root')
  const cycle = consume(f.open(1), () => {})
  expect(cycle.issues).toContain('native-tree-conflict')
  const reader = f.open(1),
    page = reader.next(reader.initialCursor)
  reader.close()
  expect(page.eof).toBeNull()
  expect(() => reader.acknowledge(page.ordinal, page.payloadDigest)).toThrow()
  expect(() => reader.next(page.cursor)).toThrow('snapshot closed')
  f.db
    .query('INSERT INTO part VALUES (?,?,?,?,?)')
    .run('broken', 'root', 'broken', 1234, 'not-json')
  const broken = f.open()
  expect(() => consume(broken, () => {})).toThrow()
})

test('unknown numeric metadata stays explicit at EOF and an open step retains its issue across packet boundaries', () => {
  const f = fixture()
  f.part('a', 'root', 'step-start')
  f.part('b', 'root', 'step-finish', 'unknown')
  const steps: NativeUsagePassPage['steps'][number][] = []
  const final = consume(f.open(1), (page) => steps.push(...page.steps))
  expect(final.eof?.counts.steps).toBe('1')
  expect(steps[0]?.usage.input).toBeNull()
  expect(final.issues).toContain('native-token-bucket-unknown')
  expect(final.issues).toContain('native-step-unfinished')
})

test('JSON booleans, nulls and composite buckets preserve the original unknown semantics instead of becoming zero or one', () => {
  const f = fixture()
  for (const [n, input] of [
    false,
    true,
    null,
    [],
    {},
    0.5,
    -1,
    'unknown',
    0,
    '0',
    '9007199254740993',
  ].entries())
    f.part(String(n).padStart(2, '0'), 'root', 'step-finish', input)
  f.part('all-booleans', 'root', 'step-finish')
  f.db.query('UPDATE part SET data=? WHERE id=?').run(
    JSON.stringify({
      type: 'step-finish',
      tokens: {
        input: false,
        output: true,
        reasoning: false,
        cache: { read: true, write: false },
      },
    }),
    'all-booleans',
  )
  const original = readNativeUsageSnapshot(f.path, 'root')
  expect(original.fingerprint).not.toBeNull()
  const values = new Map<string, NativeUsagePassPage['steps'][number]>()
  const final = consume(f.open(1), (page) => {
    for (const step of page.steps) values.set(step.stepId, step)
  })
  for (const step of original.steps) expect(values.get(step.id)?.usage).toEqual(step.usage)
  for (const n of ['00', '01', '02', '03', '04', '05', '06', '07'])
    expect(values.get(n)?.usage.input).toBeNull()
  expect(values.get('08')?.usage.input).toBe('0')
  expect(values.get('09')?.usage.input).toBe('0')
  expect(values.get('10')?.usage.input).toBe('9007199254740993')
  expect(values.get('all-booleans')?.usage).toEqual({
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
  })
  expect(final.issues).toContain('native-token-bucket-unknown')
})


test('owner identity, packet constraints, wrong cursors and oversized original rows cannot seal a subset', () => {
  const f = fixture();
  expect(() => openNativeUsagePass(f.path, { ...identity, turn: '' })).toThrow('identity unavailable');
  for (const pageRows of [0, 1001, 1.5]) {
    expect(() => openNativeUsagePass(f.path, identity, { pageRows })).toThrow('packet size');
  }
  for (const pageBytes of [1023, 1024 * 1024 + 1, 1024.5]) {
    expect(() => openNativeUsagePass(f.path, identity, { pageBytes })).toThrow('packet size');
  }
  const reader = f.open();
  expect(() => reader.next('another-owner-cursor')).toThrow('changed snapshot or position');
  expect(() => reader.acknowledge('0', 'missing-page')).toThrow('changed frozen page');
  reader.close();
  const largeRoot = 'r'.repeat(1100);
  f.session(largeRoot);
  const largeSession = openNativeUsagePass(f.path, { ...identity, rootSessionId: largeRoot }, { pageBytes: 1024 });
  cleanup.push(() => largeSession.close());
  expect(() => largeSession.next(largeSession.initialCursor)).toThrow('session exceeds packet capacity');
  expect(() => largeSession.next(largeSession.initialCursor)).toThrow('snapshot closed');
  f.part('s'.repeat(1100), 'root', 'step-finish');
  const largeStep = f.open(1000, 1024);
  expect(() => largeStep.next(largeStep.initialCursor)).toThrow('numeric row exceeds packet capacity');
  expect(() => largeStep.next(largeStep.initialCursor)).toThrow('snapshot closed');
});

test('original model and timestamp boundaries remain unknown instead of generating a usable proof', () => {
  const f = fixture();
  const cases = [
    { id: 'no-provider', providerID: null, modelID: 'model', at: 1234 },
    { id: 'long-provider', providerID: 'p'.repeat(201), modelID: 'model', at: 1234 },
    { id: 'long-model', providerID: 'provider', modelID: 'm'.repeat(301), at: 1234 },
    { id: 'negative-time', providerID: 'provider', modelID: 'model', at: -1 },
    { id: 'unsafe-time', providerID: 'provider', modelID: 'model', at: 9007199254740992 },
    { id: 'outside-time', providerID: 'provider', modelID: 'model', at: 253402300800000 },
    { id: 'valid-limits', providerID: 'p'.repeat(200), modelID: 'm'.repeat(300), at: 253402300799999 },
  ];
  for (const row of cases) {
    f.part(row.id, 'root', 'step-finish');
    f.db.query('UPDATE message SET data=? WHERE id=?').run(JSON.stringify({
      role: 'assistant', providerID: row.providerID, modelID: row.modelID,
    }), 'message-' + row.id);
    f.db.query('UPDATE part SET time_created=? WHERE id=?').run(row.at, row.id);
  }
  const original = readNativeUsageSnapshot(f.path, 'root');
  const values = new Map<string, NativeUsagePassPage['steps'][number]>();
  const final = consume(f.open(1), (page) => {
    for (const row of page.steps) values.set(row.stepId, row);
  });
  expect(values.size).toBe(cases.length);
  for (const row of original.steps) {
    const actual = values.get(row.id)!;
    expect(actual.model).toEqual(row.actualModel ? {
      provider: row.actualModel.provider, id: row.actualModel.model,
    } : null);
    expect(actual.occurredAt).toBe(row.occurredAt === null ? null : Date.parse(row.occurredAt));
    expect(actual.usage).toEqual(row.usage);
  }
  expect(final.issues).toEqual(['native-model-unavailable', 'native-time-unavailable']);
  expect(final.eof?.counts.steps).toBe(String(cases.length));
});

// P2-01: malformed start identities previously disappeared from the open-step ledger and sealed a false zero.
test.each(['', null])('malformed step message identity %p rejects the original snapshot before any clean EOF', (messageId) => {
  for (const shape of ['start-only', 'finish-only', 'paired'] as const) {
    const f = fixture();
    if (shape !== 'finish-only') f.part('a-start', 'root', 'step-start');
    if (shape !== 'start-only') f.part('z-finish', 'root', 'step-finish');
    f.db.query('UPDATE part SET message_id=?').run(messageId);
    if (shape === 'start-only') {
      const original = readNativeUsageSnapshot(f.path, 'root');
      expect(original.issues).toContain('native-step-unfinished');
      expect(original.fingerprint).toBeNull();
    }
    const reader = f.open(1);
    const first = reader.next(reader.initialCursor);
    expect(first.eof).toBeNull();
    reader.acknowledge(first.ordinal, first.payloadDigest);
    expect(() => reader.next(first.nextCursor!)).toThrow('Native step message identity unavailable');
    expect(() => reader.next(first.nextCursor!)).toThrow('snapshot closed');
  }
});
