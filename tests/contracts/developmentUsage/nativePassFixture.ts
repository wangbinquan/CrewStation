import { Database } from 'bun:sqlite';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNativeUsagePass } from '../../../packages/agent-drivers/index';
import { DevelopmentUsageRegistrationSchema, NativeUsagePassPageSchema, type NativeUsagePassPage } from '../../../packages/contracts/index';
import { textHash } from '../../../packages/kernel/index';
import type { DevelopmentNativePacketInput } from '../../../modules/observability/domain/developmentUsage/packet';

/** Actual original WAL reader. These generated fixture values never represent provider billing. */
export async function nativePassFixture(steps = 1201, depth = 70, rootBirth = true, pageRows = 37, sessionPrefix = 'fixture-session-') {
  const directory = await mkdtemp(join(tmpdir(), 'cs-native-progress-')), path = join(directory, 'original.sqlite');
  const db = new Database(path); db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
  db.exec(`CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT${rootBirth ? ',time_created INTEGER' : ''});
    CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT);
    CREATE INDEX session_parent ON session(parent_id,id); CREATE INDEX part_session ON part(session_id,id);`);
  db.exec('BEGIN');
  const insertSession = db.query(`INSERT INTO session VALUES(?,?${rootBirth ? ',?' : ''})`);
  for (let i = 0; i <= depth; i++) {
    const id = `${sessionPrefix}${String(i).padStart(4, '0')}`, parent = i === 0 ? null : `${sessionPrefix}${String(i - 1).padStart(4, '0')}`;
    if (rootBirth) insertSession.run(id, parent, 1_790_000_000_000); else insertSession.run(id, parent);
  }
  const insertMessage = db.query('INSERT INTO message VALUES(?,?,?)'), insertPart = db.query('INSERT INTO part VALUES(?,?,?,?,?)');
  const session = `${sessionPrefix}${String(depth).padStart(4, '0')}`;
  for (let i = 0; i < steps; i++) {
    const id = `fixture-message-${String(i).padStart(5, '0')}`, at = 1_790_000_001_000 + i;
    insertMessage.run(id, session, JSON.stringify({ role: 'assistant', providerID: 'fixture-provider', modelID: 'fixture-model' }));
    insertPart.run(id + ':a', session, id, at, JSON.stringify({ type: 'step-start' }));
    insertPart.run(id + ':b', session, id, at, JSON.stringify({ type: 'step-finish', tokens: { input: i + 1, output: 2, reasoning: 1, cache: { read: 3, write: 5 } } }));
  }
  db.exec('COMMIT');
  const actualPathDigest = textHash(path), sourceEpoch = crypto.randomUUID();
  const identity = { passId: crypto.randomUUID(), turn: 'fixture-turn', nativeSource: 'opencode:' + actualPathDigest,
    sourceGeneration: 'fixture-original-generation', rootSessionId: sessionPrefix + '0000', lineageKey: 'fixture-native-lineage', epoch: sourceEpoch, phase: 'final' as const };
  const reader = openNativeUsagePass(path, identity, { pageRows, pageBytes: pageRows > 37 ? 1_048_576 : 65536 });
  const executionId = Bun.randomUUIDv7();
  const registration = DevelopmentUsageRegistrationSchema.parse({ runtimeTaskId: executionId, podUid: 'fixture-original-pod',
    key: { executionId, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64) },
    identity: { sourceKind: 'development-agent', projectId: Bun.randomUUIDv7(), taskId: Bun.randomUUIDv7(), agentId: Bun.randomUUIDv7(), executionId, executionGeneration: 1 },
    profileId: Bun.randomUUIDv7(), profileRevision: 7 });
  const info = await stat(path), fileIdentityDigest = textHash(JSON.stringify([info.dev, info.ino]));
  const preparation = { turn: identity.turn, turnIndex: 4, rootSessionId: identity.rootSessionId, observedAt: '2026-10-06T00:00:00.000Z',
    store: { state: 'observed' as const, sourceEpoch, actualPathDigest, fileIdentityDigest } };
  const admission = { identity, initialCursor: reader.initialCursor, ownerReceiptId: 'fixture-original-owner', sourceWatermark: '0' };
  let sequence = 0;
  const packets = (raw: unknown): DevelopmentNativePacketInput[] => {
    const page: NativeUsagePassPage = NativeUsagePassPageSchema.parse(raw), packetCount = Math.max(1, Math.ceil(page.steps.length / 100));
    const from = sequence + 1; sequence += packetCount;
    const ack = { contract: 'native-usage-page-ack-v2' as const, identity: page.identity, ownerReceiptId: admission.ownerReceiptId,
      ordinal: page.ordinal, payloadDigest: page.payloadDigest, cumulativeDigest: page.cumulativeDigest, scanPositionAfter: page.scanPositionAfter,
      counts: page.counts, nextCursor: page.nextCursor, sourceWatermark: String(sequence), eof: page.eof };
    const original = { version: 2 as const, key: registration.key, podUid: registration.podUid, preparation,
      baselineKind: 'fresh' as const, rootCreatedAt: reader.rootCreatedAt, admission, ack, document: JSON.stringify(raw) };
    return Array.from({ length: packetCount }, (_, packetIndex) => ({ key: registration.key, registration,
      ownerRegistration: structuredClone(registration), selection: { version: 2, expectedNamespace: identity.lineageKey }, original,
      event: { sequence: from + packetIndex, occurredAt: '2026-10-06T00:00:01.000Z', capture: { version: 2, diagnostics: [],
        nativeSource: { version: 2, stage: 'page', turnIndex: 4, ack, sequenceFrom: from, sequenceThrough: sequence,
          sequence: from + packetIndex, packetIndex, packetCount }, measurements: page.steps.slice(packetIndex * 100, (packetIndex + 1) * 100) } } }));
  };
  return { reader, registration, packets, close: async () => { reader.close(); db.close(); await rm(directory, { recursive: true, force: true }); } };
}
