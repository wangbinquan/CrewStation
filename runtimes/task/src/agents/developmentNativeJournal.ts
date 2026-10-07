import { DevelopmentNativeTurnCheckpoints } from './development/nativeTurnCheckpoints';
import type { DevelopmentNativeJournalBinding } from './development/nativeJournalBinding';
export type { DevelopmentNativeJournalBinding } from './development/nativeJournalBinding';
type NativeAuthority = ReturnType<DevelopmentNativeJournalBinding['original']>;
import type { DevelopmentNativeTurnInput } from '@crewstation/agent-drivers';
import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { NativeUsagePassOwner } from '@crewstation/agent-drivers';
import {
  DevelopmentNativePreparationSchema, DevelopmentNativePageCaptureSchema, DevelopmentUsageEventSchema,
  NativeUsagePassIdentitySchema, NativeUsagePassPageSchema, NativeUsagePassAckSchema, NativeUsagePassAdmissionSchema,
  type DevelopmentNativePreparation, type DevelopmentUsageKey,
  type NativeUsagePassIdentity, type NativeUsagePassPage, type NativeUsagePassAck, type NativeUsagePassAdmission,
} from '@crewstation/contracts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = isDeepStrictEqual;
interface PassRow {
  pass_id: string; execution_id: string; turn: string; identity_json: string; admission_json: string;
  root_created_at: number | null; next_cursor: string | null; ordinal: string; scan_position: string;
  previous_digest: string; counts_json: string; state: string; reason: string | null;
}
interface ParentRow { session_id: string; parent_id: string | null; depth: string; path_digest: string }
interface PageRow { document: string; ack: string; sequence_from: number; sequence_through: number }

/** Retained original facts; reading does not grant launch, ACK, or completion authority. */
export interface DevelopmentNativePageEvidence {
  readonly key: DevelopmentUsageKey;
  readonly podUid: string;
  readonly preparation: DevelopmentNativePreparation;
  readonly baselineKind: 'fresh' | 'resume';
  readonly admission: NativeUsagePassAdmission;
  readonly rootCreatedAt: number | null;
  readonly document: string;
  readonly ack: NativeUsagePassAck;
}
function pageDigests(raw: Parameters<NativeUsagePassOwner['persist']>[0]) {
  const body = { identity: raw.identity, ordinal: raw.ordinal, scanPositionBefore: raw.scanPositionBefore,
    scanPositionAfter: raw.scanPositionAfter, scannedRawRows: raw.scannedRawRows, counts: raw.counts,
    sessions: raw.sessions, steps: raw.steps, issues: raw.issues, eof: raw.eof };
  const payload = hash(body);
  return { payload, cumulative: hash([raw.previousDigest, payload]) };
}

/** Original accepted FULL/WAL connection. Tables retain evidence; none is a numeric ledger. */
export class DevelopmentNativeJournal {
  private readonly turns: DevelopmentNativeTurnCheckpoints;
  constructor(private readonly db: Database, private readonly binding: DevelopmentNativeJournalBinding) {
    db.exec(`CREATE TABLE IF NOT EXISTS development_native_preparations (
      execution_id TEXT NOT NULL,turn TEXT NOT NULL,document TEXT NOT NULL,PRIMARY KEY(execution_id,turn));
      CREATE TABLE IF NOT EXISTS development_native_passes (
      pass_id TEXT PRIMARY KEY,execution_id TEXT NOT NULL,turn TEXT NOT NULL,identity_json TEXT NOT NULL,
      admission_json TEXT NOT NULL,root_created_at INTEGER,next_cursor TEXT,ordinal TEXT NOT NULL,
      scan_position TEXT NOT NULL,previous_digest TEXT NOT NULL,counts_json TEXT NOT NULL,state TEXT NOT NULL,reason TEXT);
      CREATE INDEX IF NOT EXISTS development_native_owner_passes ON development_native_passes(execution_id,turn);
      CREATE TABLE IF NOT EXISTS development_native_pages (
      pass_id TEXT NOT NULL,ordinal TEXT NOT NULL,document TEXT NOT NULL,ack TEXT NOT NULL,
      sequence_from INTEGER NOT NULL,sequence_through INTEGER NOT NULL,PRIMARY KEY(pass_id,ordinal));
      CREATE TABLE IF NOT EXISTS development_native_parents (
      pass_id TEXT NOT NULL,session_id TEXT NOT NULL,parent_id TEXT,depth TEXT NOT NULL,path_digest TEXT NOT NULL,
      ordinal TEXT NOT NULL,PRIMARY KEY(pass_id,session_id));
      CREATE TABLE IF NOT EXISTS development_native_steps (
      pass_id TEXT NOT NULL,step_id TEXT NOT NULL,session_id TEXT NOT NULL,document TEXT NOT NULL,
      ordinal TEXT NOT NULL,PRIMARY KEY(pass_id,step_id));`);
    this.turns = new DevelopmentNativeTurnCheckpoints(db, binding);
  }

  beginTurn(key: DevelopmentUsageKey, input: DevelopmentNativeTurnInput): void {
    this.outer(); this.authority(key); this.turns.begin(key, input);
  }

  turnOwner(key: DevelopmentUsageKey, raw: DevelopmentNativePreparation, rootCreatedAt: number | null): NativeUsagePassOwner {
    this.outer(); this.authority(key);
    const prepared = DevelopmentNativePreparationSchema.parse(raw), checkpoint = this.turns.bind(key, prepared, rootCreatedAt);
    return this.owner(key, prepared, hash(checkpoint));
  }

  owner(key: DevelopmentUsageKey, raw: DevelopmentNativePreparation, turnCheckpointDigest?: string): NativeUsagePassOwner {
    this.outer();
    const prepared = DevelopmentNativePreparationSchema.parse(raw), original = this.authority(key);
    const header = JSON.parse(original.header) as { nativeSource?: { version: number }; nativeAdmission?: { lineageKey: string; resumeSessionId: string | null } };
    if (header.nativeSource?.version !== 2 || !header.nativeAdmission)
      throw new Error('Original admission did not explicitly select native v2');
    const checkpoint = turnCheckpointDigest === undefined ? undefined : this.turns.read(key, prepared.turn);
    if (checkpoint) {
      this.turns.matches(checkpoint, prepared);
      if (hash(checkpoint) !== turnCheckpointDigest || checkpoint.rootSessionId !== prepared.rootSessionId)
        throw new Error('Native owner changed its original turn checkpoint');
    }
    const selected = checkpoint ?? header.nativeAdmission;
    if (selected.resumeSessionId !== null && selected.resumeSessionId !== prepared.rootSessionId)
      throw new Error('Native prepared root changed the original resume intent');
    const document = JSON.stringify({ key, podUid: this.binding.podUid, ...prepared, lineageKey: selected.lineageKey,
      baselineKind: selected.resumeSessionId === null ? 'fresh' : 'resume', ...(turnCheckpointDigest === undefined ? {} : { turnCheckpointDigest }) });
    this.db.transaction(() => {
      this.authority(key);
      const prior = this.db.query<{ document: string }, [string, string]>(
        'SELECT document FROM development_native_preparations WHERE execution_id=? AND turn=?').get(key.executionId, prepared.turn);
      if (prior && prior.document !== document) throw new Error('Original native preparation changed');
      if (!prior) this.db.query('INSERT INTO development_native_preparations VALUES(?,?,?)').run(key.executionId, prepared.turn, document);
    }).immediate();
    const check = (identity: NativeUsagePassIdentity) => {
      if (this.authority(key).header !== original.header) throw new Error('Original native admission header changed');
      if (checkpoint && hash(this.turns.read(key, prepared.turn)) !== turnCheckpointDigest)
        throw new Error('Native pass changed its original turn checkpoint');
      const actual = this.db.query<{ document: string }, [string, string]>(
        'SELECT document FROM development_native_preparations WHERE execution_id=? AND turn=?').get(key.executionId, prepared.turn);
      if (!actual || actual.document !== document) throw new Error('Original native preparation is missing or changed');
      if (identity.turn !== prepared.turn || identity.lineageKey !== selected.lineageKey ||
          identity.rootSessionId !== prepared.rootSessionId || identity.nativeSource !== 'opencode:' + prepared.store.actualPathDigest ||
          identity.sourceGeneration !== hash(prepared.store) || identity.epoch !== prepared.store.sourceEpoch ||
          (identity.phase === 'baseline' && selected.resumeSessionId === null))
        throw new Error('Native pass changed its original accepted source or turn');
    };
    return {
      admit: async (identity, cursor, rootCreatedAt) => {
        this.outer(); NativeUsagePassIdentitySchema.parse(identity); check(identity);
        if (checkpoint && checkpoint.rootCreatedAt !== rootCreatedAt)
          throw new Error('Native pass changed its checkpoint original root birth');
        if (cursor !== JSON.stringify([identity.passId, '0', hash(identity)]) ||
            (rootCreatedAt !== null && (!Number.isSafeInteger(rootCreatedAt) || rootCreatedAt < 0 || rootCreatedAt >= 253402300800000)))
          throw new Error('Native admission changed original cursor or root birth');
        const admission = this.db.transaction(() => {
          check(identity);
          const previous = this.pass(identity.passId);
          if (previous) {
            if (previous.execution_id !== key.executionId || previous.identity_json !== JSON.stringify(identity) ||
                previous.root_created_at !== rootCreatedAt || JSON.parse(previous.admission_json).initialCursor !== cursor)
              throw new Error('Native admission replay changed original bytes');
            return NativeUsagePassAdmissionSchema.parse(JSON.parse(previous.admission_json));
          }
          const row = this.binding.original(key);
          const value = NativeUsagePassAdmissionSchema.parse({ identity, initialCursor: cursor,
            ownerReceiptId: 'native-owner:' + hash([document, identity]), sourceWatermark: String(row.lastSequence) });
          this.db.query('INSERT INTO development_native_passes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
            identity.passId, key.executionId, prepared.turn, JSON.stringify(identity), JSON.stringify(value), rootCreatedAt,
            cursor, '0', '0', hash(identity), JSON.stringify({ sessions: '0', parts: '0', steps: '0' }), 'walking', null);
          return value;
        }).immediate();
        return admission;
      },
      persist: async (rawPage) => this.persist(key, prepared, rawPage, check),
      interrupt: async (identity, reason) => {
        this.outer(); NativeUsagePassIdentitySchema.parse(identity); check(identity);
        this.db.transaction(() => {
          check(identity); const pass = this.pass(identity.passId);
          if (!pass || pass.execution_id !== key.executionId || !same(JSON.parse(pass.identity_json), identity))
            throw new Error('Interrupted native pass changed original identity');
          if (pass.state !== 'eof') this.db.query('UPDATE development_native_passes SET state=?,reason=? WHERE pass_id=?').run('interrupted', reason, pass.pass_id);
        }).immediate();
      },
    };
  }

  /** Read committed raw bytes and all retained relations, including after numeric ACK/restart. */
  readPage(key: DevelopmentUsageKey, passId: string, ordinal: string): DevelopmentNativePageEvidence {
    this.outer();
    const original = this.binding.original(key), pass = this.pass(passId);
    if (!pass || pass.execution_id !== key.executionId || !/^(0|[1-9][0-9]*)$/.test(ordinal))
      throw new Error('Original native pass or page is unavailable');
    const stored = this.db.query<{ document: string }, [string, string]>(
      'SELECT document FROM development_native_preparations WHERE execution_id=? AND turn=?').get(key.executionId, pass.turn);
    const saved = this.db.query<PageRow, [string, string]>(
      'SELECT document,ack,sequence_from,sequence_through FROM development_native_pages WHERE pass_id=? AND ordinal=?').get(passId, ordinal);
    if (!stored || !saved) throw new Error('Original native preparation or page is unavailable');
    const { key: preparedKey, podUid, lineageKey, baselineKind, turnCheckpointDigest, ...rawPreparation } = JSON.parse(stored.document);
    const prepared = DevelopmentNativePreparationSchema.parse(rawPreparation);
    const header = JSON.parse(original.header) as { nativeSource?: { version: number }; nativeAdmission?: { lineageKey: string; resumeSessionId: string | null } };
    const checkpoint = turnCheckpointDigest === undefined ? undefined : this.turns.read(key, prepared.turn);
    if (checkpoint) {
      this.turns.matches(checkpoint, prepared);
      if (hash(checkpoint) !== turnCheckpointDigest || checkpoint.rootSessionId !== prepared.rootSessionId ||
          checkpoint.rootCreatedAt !== pass.root_created_at) throw new Error('Retained native turn checkpoint changed');
    }
    const selected = checkpoint ?? header.nativeAdmission;
    const identity = NativeUsagePassIdentitySchema.parse(JSON.parse(pass.identity_json));
    const admission = NativeUsagePassAdmissionSchema.parse(JSON.parse(pass.admission_json));
    const raw = JSON.parse(saved.document) as NativeUsagePassPage, page = NativeUsagePassPageSchema.parse(raw);
    const ack = NativeUsagePassAckSchema.parse(JSON.parse(saved.ack)), digests = pageDigests(raw);
    if (pass.root_created_at !== null && (!Number.isSafeInteger(pass.root_created_at) || pass.root_created_at < 0 || pass.root_created_at >= 253402300800000))
      throw new Error('Retained native original root birth is invalid');
    if (!same(preparedKey, key) || podUid !== this.binding.podUid || original.incarnation !== key.incarnation ||
        header.nativeSource?.version !== 2 || !header.nativeAdmission ||
        lineageKey !== header.nativeAdmission.lineageKey || baselineKind !== (selected?.resumeSessionId === null ? 'fresh' : 'resume') ||
        (baselineKind === 'resume' && prepared.rootSessionId !== selected?.resumeSessionId) ||
        identity.turn !== prepared.turn || identity.lineageKey !== lineageKey || identity.rootSessionId !== prepared.rootSessionId ||
        identity.nativeSource !== 'opencode:' + prepared.store.actualPathDigest || identity.sourceGeneration !== hash(prepared.store) ||
        identity.epoch !== prepared.store.sourceEpoch || !same(admission.identity, identity) || !same(page.identity, identity) ||
        page.ordinal !== ordinal || page.payloadDigest !== digests.payload || page.cumulativeDigest !== digests.cumulative ||
        ack.ownerReceiptId !== admission.ownerReceiptId || Number(ack.sourceWatermark) > original.lastSequence)
      throw new Error('Retained native original page binding or digest changed');
    this.retained(key, prepared, page, saved, ack);
    return { key: structuredClone(key), podUid, preparation: prepared, baselineKind, admission,
      rootCreatedAt: pass.root_created_at, document: saved.document, ack };
  }

  private persist(key: DevelopmentUsageKey, prepared: DevelopmentNativePreparation, rawPage: Parameters<NativeUsagePassOwner['persist']>[0],
    check: (identity: NativeUsagePassIdentity) => void): NativeUsagePassAck {
    this.outer(); const page = NativeUsagePassPageSchema.parse(rawPage); check(page.identity);
    const rawDocument = JSON.stringify(rawPage);
    const ack = this.db.transaction(() => {
      check(page.identity);
      const pass = this.pass(page.identity.passId);
      if (!pass || pass.execution_id !== key.executionId || !same(JSON.parse(pass.identity_json), page.identity))
        throw new Error('Native original pass is unavailable');
      const prior = this.db.query<PageRow, [string, string]>(
        'SELECT document,ack,sequence_from,sequence_through FROM development_native_pages WHERE pass_id=? AND ordinal=?').get(pass.pass_id, page.ordinal);
      if (prior) {
        if (prior.document !== rawDocument) throw new Error('Native page replay changed original bytes');
        const retained = NativeUsagePassAckSchema.parse(JSON.parse(prior.ack));
        this.retained(key, prepared, page, prior, retained);
        return retained;
      }
      this.progress(pass, page, rawPage);
      for (const session of page.sessions) {
        const parent = session.parentSessionId === null ? null : this.parent(pass.pass_id, session.parentSessionId);
        if (session.parentSessionId !== null && !parent) throw new Error('Native original parent is missing');
        const depth = parent ? String(BigInt(parent.depth) + 1n) : '0';
        const pathDigest = hash(parent ? [parent.path_digest, session.id, session.parentSessionId]
          : [page.identity.nativeSource, page.identity.sourceGeneration, session.id]);
        this.db.query('INSERT INTO development_native_parents VALUES(?,?,?,?,?,?)').run(
          pass.pass_id, session.id, session.parentSessionId, depth, pathDigest, page.ordinal);
      }
      const checked = new Set<string>();
      for (const session of page.sessions) this.path(pass.pass_id, session.id, page.identity, checked);
      for (const step of page.steps) {
        this.path(pass.pass_id, step.id, page.identity, checked);
        const parent = this.parent(pass.pass_id, step.id);
        if (!parent || parent.parent_id !== step.parentSessionId) throw new Error('Native numeric row lost its original full parent path');
        this.db.query('INSERT INTO development_native_steps VALUES(?,?,?,?,?)').run(
          pass.pass_id, step.stepId, step.id, JSON.stringify(step), page.ordinal);
      }
      const row = this.binding.original(key), packets = this.packets(key, page, prepared, row.lastSequence, JSON.parse(pass.admission_json).ownerReceiptId);
      let bytes = 0;
      for (const event of packets.events) {
        const size = Buffer.byteLength(JSON.stringify(event)); bytes += size;
        this.db.query('INSERT INTO events(execution_id,sequence,occurred_at,body,bytes) VALUES(?,?,?,?,?)').run(
          key.executionId, event.sequence, event.occurredAt, JSON.stringify(event.capture), size);
      }
      this.db.query('UPDATE executions SET last_sequence=?,spool_bytes=spool_bytes+? WHERE execution_id=?').run(
        Number(packets.ack.sourceWatermark), bytes, key.executionId);
      this.db.query('INSERT INTO development_native_pages VALUES(?,?,?,?,?,?)').run(
        pass.pass_id, page.ordinal, rawDocument, JSON.stringify(packets.ack), row.lastSequence + 1, Number(packets.ack.sourceWatermark));
      this.db.query('UPDATE development_native_passes SET next_cursor=?,ordinal=?,scan_position=?,previous_digest=?,counts_json=?,state=? WHERE pass_id=?').run(
        page.nextCursor, String(BigInt(page.ordinal) + 1n), page.scanPositionAfter, page.cumulativeDigest,
        JSON.stringify(page.counts), page.eof ? 'eof' : 'walking', pass.pass_id);
      return packets.ack;
    }).immediate();
    // A return from the immediate transaction is the actual COMMIT acknowledgement.
    this.binding.committed(key);
    return ack;
  }

  private outer(): void {
    if (this.db.inTransaction) throw new Error('Native positive ACK requires the original outer COMMIT');
  }
  private authority(key: DevelopmentUsageKey): NativeAuthority {
    const row = this.binding.original(key);
    if (key.journalId !== this.binding.journalId || key.incarnation !== this.binding.incarnation ||
        row.incarnation !== key.incarnation || row.interruption !== null || !['registered', 'running'].includes(row.phase))
      throw new Error('Native owner requires the current original accepted execution');
    return row;
  }
  private pass(id: string): PassRow | null {
    return this.db.query<PassRow, [string]>('SELECT * FROM development_native_passes WHERE pass_id=?').get(id);
  }
  private parent(pass: string, session: string): ParentRow | null {
    return this.db.query<ParentRow, [string, string]>(
      'SELECT session_id,parent_id,depth,path_digest FROM development_native_parents WHERE pass_id=? AND session_id=?').get(pass, session);
  }
  /** Verify the retained original chain through its root; packet/cache bounds never truncate ancestry. */
  private path(pass: string, session: string, identity: NativeUsagePassIdentity, checked: Set<string>): void {
    const chain: ParentRow[] = [], visited = new Set<string>();
    let current: string | null = session;
    while (current !== null && !checked.has(current)) {
      if (visited.has(current)) throw new Error('Retained native original parent cycle');
      visited.add(current);
      const row = this.parent(pass, current);
      if (!row) throw new Error('Retained native full parent path is missing');
      chain.push(row); current = row.parent_id;
    }
    for (const row of chain.reverse()) {
      const parent = row.parent_id === null ? null : this.parent(pass, row.parent_id);
      if ((row.parent_id === null && row.session_id !== identity.rootSessionId) ||
          (row.parent_id !== null && !parent) || row.depth !== (parent ? String(BigInt(parent.depth) + 1n) : '0') ||
          row.path_digest !== hash(parent ? [parent.path_digest, row.session_id, row.parent_id]
            : [identity.nativeSource, identity.sourceGeneration, row.session_id]))
        throw new Error('Retained native original full parent path changed');
      checked.add(row.session_id);
    }
  }
  private progress(pass: PassRow, page: NativeUsagePassPage, raw: Parameters<NativeUsagePassOwner['persist']>[0]): void {
    const counts = JSON.parse(pass.counts_json) as NativeUsagePassPage['counts'];
    const { payload, cumulative } = pageDigests(raw);
    if (pass.state !== 'walking' || page.ordinal !== pass.ordinal || page.cursor !== pass.next_cursor ||
        page.scanPositionBefore !== pass.scan_position || page.previousDigest !== pass.previous_digest ||
        page.payloadDigest !== payload || page.cumulativeDigest !== cumulative ||
        page.nextCursor !== (page.eof ? null : JSON.stringify([pass.pass_id, String(BigInt(page.ordinal) + 1n), cumulative])) ||
        BigInt(page.counts.sessions) !== BigInt(counts.sessions) + BigInt(page.sessions.length) ||
        BigInt(page.counts.steps) !== BigInt(counts.steps) + BigInt(page.steps.length) ||
        BigInt(page.counts.parts) < BigInt(counts.parts) ||
        BigInt(page.counts.parts) - BigInt(counts.parts) > BigInt(page.scannedRawRows))
      throw new Error('Native page changed original progress, digests, population or EOF');
  }
  private retained(key: DevelopmentUsageKey, prepared: DevelopmentNativePreparation, page: NativeUsagePassPage,
    saved: PageRow, ack: NativeUsagePassAck): void {
    const checked = new Set<string>();
    for (const session of page.sessions) {
      this.path(page.identity.passId, session.id, page.identity, checked);
      const actual = this.parent(page.identity.passId, session.id);
      if (!actual || actual.parent_id !== session.parentSessionId) throw new Error('Retained native original parent is missing');
      const parent = session.parentSessionId === null ? null : this.parent(page.identity.passId, session.parentSessionId);
      if (session.parentSessionId !== null && !parent) throw new Error('Retained native full parent path is missing');
      if (actual.depth !== (parent ? String(BigInt(parent.depth) + 1n) : '0') ||
          actual.path_digest !== hash(parent ? [parent.path_digest, session.id, session.parentSessionId]
            : [page.identity.nativeSource, page.identity.sourceGeneration, session.id]))
        throw new Error('Retained native full parent path changed');
    }
    for (const step of page.steps) {
      this.path(page.identity.passId, step.id, page.identity, checked);
      const actual = this.db.query<{ document: string; ordinal: string }, [string, string]>(
        'SELECT document,ordinal FROM development_native_steps WHERE pass_id=? AND step_id=?').get(page.identity.passId, step.stepId);
      if (!actual || !same(JSON.parse(actual.document), step) || actual.ordinal !== page.ordinal)
        throw new Error('Retained original native membership is missing or changed');
    }
    const packets = this.packets(key, page, prepared, saved.sequence_from - 1, ack.ownerReceiptId);
    if (!same(packets.ack, ack) || Number(ack.sourceWatermark) !== saved.sequence_through)
      throw new Error('Retained native original source range changed');
    const original = this.binding.original(key);
    for (const event of packets.events) {
      if (event.sequence <= original.acknowledgedSequence) continue;
      const actual = this.db.query<{ body: string; occurred_at: string }, [string, number]>(
        'SELECT body,occurred_at FROM events WHERE execution_id=? AND sequence=?').get(key.executionId, event.sequence);
      if (!actual || actual.body !== JSON.stringify(event.capture) || actual.occurred_at !== event.occurredAt)
        throw new Error('Retained pending original native source frame is missing or changed');
    }
  }
  private packets(key: DevelopmentUsageKey, page: NativeUsagePassPage, prepared: DevelopmentNativePreparation, after: number, ownerReceiptId: string) {
    const chunks: NativeUsagePassPage['steps'][] = [];
    for (let offset = 0; offset < page.steps.length; offset += 100) chunks.push(page.steps.slice(offset, offset + 100));
    if (!chunks.length) chunks.push([]);
    for (;;) {
      const through = after + chunks.length;
      if (!Number.isSafeInteger(through)) throw new Error('Original numeric sequence is no longer exact');
      const ack = NativeUsagePassAckSchema.parse({ contract: 'native-usage-page-ack-v2', identity: page.identity, ownerReceiptId,
        ordinal: page.ordinal, payloadDigest: page.payloadDigest, cumulativeDigest: page.cumulativeDigest,
        scanPositionAfter: page.scanPositionAfter, counts: page.counts, nextCursor: page.nextCursor,
        sourceWatermark: String(through), eof: page.eof });
      const events = chunks.map((measurements, index) => DevelopmentUsageEventSchema.parse({
        sequence: after + index + 1, occurredAt: prepared.observedAt,
        capture: DevelopmentNativePageCaptureSchema.parse({ version: 2,
          nativeSource: { version: 2, stage: 'page', turnIndex: prepared.turnIndex, ack,
            sequenceFrom: after + 1, sequenceThrough: through, sequence: after + index + 1,
            packetIndex: index, packetCount: chunks.length }, measurements, diagnostics: [] }) }));
      const oversized = events.findIndex((event) => Buffer.byteLength(JSON.stringify(event)) > this.binding.eventBytes ||
        Buffer.byteLength(JSON.stringify({ key, after: event.sequence - 1,
          through: event.sequence, events: [event] })) > this.binding.pageBytes);
      if (oversized < 0) return { ack, events };
      const chunk = chunks[oversized]!;
      if (chunk.length <= 1) throw new Error('One native original frame exceeds the transport packet');
      const middle = Math.ceil(chunk.length / 2); chunks.splice(oversized, 1, chunk.slice(0, middle), chunk.slice(middle));
    }
  }
}
