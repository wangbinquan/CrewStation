import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DevelopmentNativePreparationSchema, DevelopmentNativeStoreSchema, DevelopmentUsageKeySchema, NativeUsagePassPageSchema, NativeUsagePassAckSchema, NativeUsagePassIdentitySchema, type DevelopmentNativePreparation, type DevelopmentUsageKey } from '@crewstation/contracts';
import type { DevelopmentNativeTurnInput } from '@crewstation/agent-drivers';
import type { DevelopmentNativeJournalBinding } from './nativeJournalBinding';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface DevelopmentNativeTurnCheckpoint extends DevelopmentNativeTurnInput {
  readonly key: DevelopmentUsageKey;
  readonly podUid: string;
  readonly headerDigest: string;
  readonly lineageKey: string;
  readonly rootSessionId: string | null;
  readonly rootCreatedAt: number | null;
  readonly previousFinalPassId: string | null;
}
interface Stored { document: string }
interface Previous { turn: string; turn_index: number; document: string }

/** A turn owns one committed original source; the initial admission header is never rewritten. */
export class DevelopmentNativeTurnCheckpoints {
  constructor(private readonly db: Database, private readonly binding: DevelopmentNativeJournalBinding) {
    db.exec(`CREATE TABLE IF NOT EXISTS development_native_turn_checkpoints (
      execution_id TEXT NOT NULL,turn TEXT NOT NULL,turn_index INTEGER NOT NULL,document TEXT NOT NULL,
      PRIMARY KEY(execution_id,turn),UNIQUE(execution_id,turn_index));`);
  }

  begin(key: DevelopmentUsageKey, raw: DevelopmentNativeTurnInput): void {
    this.db.transaction(() => {
      const original = this.binding.original(key), header = this.header(original.header);
      if (original.incarnation !== this.binding.incarnation || key.incarnation !== this.binding.incarnation ||
          original.interruption || !['registered', 'running'].includes(original.phase))
        throw new Error('Native turn requires its original live execution');
      const store = DevelopmentNativeStoreSchema.parse(raw.store);
      if (store.state !== 'observed' || !/^[a-f0-9]{64}$/.test(raw.plannedPathDigest))
        throw new Error('Native turn requires its actual initialized source');
      const turn = DevelopmentNativePreparationSchema.shape.turn.parse(raw.turn);
      const turnIndex = DevelopmentNativePreparationSchema.shape.turnIndex.parse(raw.turnIndex);
      const observedAt = DevelopmentNativePreparationSchema.shape.observedAt.parse(raw.observedAt);
      const resumeSessionId = raw.resumeSessionId === null ? null
        : DevelopmentNativePreparationSchema.shape.rootSessionId.parse(raw.resumeSessionId);
      const before = this.db.query<Stored, [string, string]>(
        'SELECT document FROM development_native_turn_checkpoints WHERE execution_id=? AND turn=?').get(key.executionId, turn);
      if (before) {
        const saved = this.read(key, turn);
        if (!isDeepStrictEqual({ turn: saved.turn, turnIndex: saved.turnIndex, observedAt: saved.observedAt,
          resumeSessionId: saved.resumeSessionId, plannedPathDigest: saved.plannedPathDigest, store: saved.store },
          { turn, turnIndex, observedAt, resumeSessionId, plannedPathDigest: raw.plannedPathDigest, store }))
          throw new Error('Native turn checkpoint replay changed original facts');
        return;
      }
      const previous = this.db.query<Previous, [string]>(
        'SELECT turn,turn_index,document FROM development_native_turn_checkpoints WHERE execution_id=? ORDER BY turn_index DESC LIMIT 1').get(key.executionId);
      let previousFinalPassId: string | null = null;
      if (!previous) {
        if (turnIndex !== 0 || resumeSessionId !== header.nativeAdmission.resumeSessionId)
          throw new Error('Initial native turn changed the original resume intent');
        // Existing initial-only owners are not promoted into successor-turn authority.
        const prepared = this.db.query<Stored, [string]>(
          'SELECT document FROM development_native_preparations WHERE execution_id=? LIMIT 1').get(key.executionId);
        if (prepared) throw new Error('Cannot start a new turn chain over existing original preparations');
      } else {
        const prior = this.read(key, previous.turn);
        if (turnIndex !== previous.turn_index + 1 || !prior.rootSessionId || resumeSessionId !== prior.rootSessionId ||
            !isDeepStrictEqual(store, prior.store) || Date.parse(observedAt) < Date.parse(prior.observedAt))
          throw new Error('Successor native turn changed original root, source, time or order');
        previousFinalPassId = this.previousFinal(key, prior);
      }
      const document: DevelopmentNativeTurnCheckpoint = { key: DevelopmentUsageKeySchema.parse(key),
        podUid: this.binding.podUid, headerDigest: hash(original.header), lineageKey: header.nativeAdmission.lineageKey,
        turn, turnIndex, store, plannedPathDigest: raw.plannedPathDigest, observedAt, resumeSessionId,
        rootSessionId: resumeSessionId, rootCreatedAt: null, previousFinalPassId };
      this.db.query('INSERT INTO development_native_turn_checkpoints VALUES(?,?,?,?)').run(key.executionId, turn, turnIndex, JSON.stringify(document));
    }).immediate();
  }

  bind(key: DevelopmentUsageKey, prepared: DevelopmentNativePreparation, rootCreatedAt: number | null): DevelopmentNativeTurnCheckpoint {
    return this.db.transaction(() => {
      const before = this.read(key, prepared.turn);
      this.matches(before, prepared);
      if (rootCreatedAt !== null && (!Number.isSafeInteger(rootCreatedAt) || rootCreatedAt < 0 || rootCreatedAt >= 253402300800000))
        throw new Error('Original native root birth is unavailable');
      if (before.rootSessionId !== null && before.rootSessionId !== prepared.rootSessionId)
        throw new Error('Native turn cannot replace its original bound root');
      if (before.resumeSessionId === null && (rootCreatedAt === null || rootCreatedAt < Date.parse(before.observedAt)))
        throw new Error('Fresh native root did not actually originate after its checkpoint');
      if (before.rootCreatedAt !== null && before.rootCreatedAt !== rootCreatedAt)
        throw new Error('Native root birth changed its original turn');
      const next = { ...before, rootSessionId: prepared.rootSessionId, rootCreatedAt };
      this.db.query('UPDATE development_native_turn_checkpoints SET document=? WHERE execution_id=? AND turn=?').run(JSON.stringify(next), key.executionId, prepared.turn);
      return next;
    }).immediate();
  }

  read(key: DevelopmentUsageKey, turn: string): DevelopmentNativeTurnCheckpoint {
    const original = this.binding.original(key), header = this.header(original.header);
    const row = this.db.query<Stored, [string, string]>(
      'SELECT document FROM development_native_turn_checkpoints WHERE execution_id=? AND turn=?').get(key.executionId, turn);
    if (!row) throw new Error('Original native turn checkpoint is unavailable');
    const saved = JSON.parse(row.document) as DevelopmentNativeTurnCheckpoint;
    if (!isDeepStrictEqual(DevelopmentUsageKeySchema.parse(saved.key), key) || saved.podUid !== this.binding.podUid ||
        saved.headerDigest !== hash(original.header) || saved.lineageKey !== header.nativeAdmission.lineageKey ||
        saved.turn !== turn || !Number.isSafeInteger(saved.turnIndex) || saved.turnIndex < 0 ||
        DevelopmentNativeStoreSchema.parse(saved.store).state !== 'observed' ||
        !/^[a-f0-9]{64}$/.test(saved.plannedPathDigest) || !Number.isFinite(Date.parse(saved.observedAt)) ||
        (saved.rootCreatedAt !== null && (!Number.isSafeInteger(saved.rootCreatedAt) || saved.rootCreatedAt < 0 || saved.rootCreatedAt >= 253402300800000)))
      throw new Error('Original native turn checkpoint changed its binding');
    if (saved.turnIndex === 0) {
      if (saved.resumeSessionId !== header.nativeAdmission.resumeSessionId || saved.previousFinalPassId !== null)
        throw new Error('Initial native turn changed its original intention');
    } else {
      const previous = this.db.query<Previous, [string, number]>(
        'SELECT turn,turn_index,document FROM development_native_turn_checkpoints WHERE execution_id=? AND turn_index=?').get(key.executionId, saved.turnIndex - 1);
      if (!previous) throw new Error('Native turn lost its original predecessor');
      const prior = JSON.parse(previous.document) as DevelopmentNativeTurnCheckpoint;
      if (!prior.rootSessionId || saved.resumeSessionId !== prior.rootSessionId || !isDeepStrictEqual(saved.store, prior.store) ||
          saved.previousFinalPassId !== this.previousFinal(key, prior))
        throw new Error('Native turn lost its actual original final predecessor');
    }
    if (saved.resumeSessionId !== null && saved.rootSessionId !== saved.resumeSessionId)
      throw new Error('Resume checkpoint changed its original root');
    if (saved.resumeSessionId === null && saved.rootSessionId !== null &&
        (saved.rootCreatedAt === null || saved.rootCreatedAt < Date.parse(saved.observedAt)))
      throw new Error('Fresh checkpoint root predates its actual preparation');
    return saved;
  }

  matches(saved: DevelopmentNativeTurnCheckpoint, prepared: DevelopmentNativePreparation): void {
    if (saved.turn !== prepared.turn || saved.turnIndex !== prepared.turnIndex || saved.observedAt !== prepared.observedAt ||
        !isDeepStrictEqual(saved.store, prepared.store)) throw new Error('Native preparation changed its original turn checkpoint');
  }

  private previousFinal(key: DevelopmentUsageKey, previous: DevelopmentNativeTurnCheckpoint): string {
    const passes = this.db.query<{ pass_id: string; identity_json: string; ordinal: string; previous_digest: string; counts_json: string }, [string, string]>(
      `SELECT pass_id,identity_json,ordinal,previous_digest,counts_json FROM development_native_passes WHERE execution_id=? AND turn=?
       AND state='eof' AND json_extract(identity_json,'$.phase')='final' ORDER BY pass_id LIMIT 2`).all(key.executionId, previous.turn);
    if (passes.length !== 1) throw new Error('Successor turn requires one actual persisted final EOF');
    const pass = passes[0]!, identity = NativeUsagePassIdentitySchema.parse(JSON.parse(pass.identity_json));
    const last = this.db.query<{ document: string; ack: string }, [string, string]>(
      'SELECT document,ack FROM development_native_pages WHERE pass_id=? AND ordinal=?').get(pass.pass_id, String(BigInt(pass.ordinal) - 1n));
    if (!last || identity.rootSessionId !== previous.rootSessionId || identity.turn !== previous.turn ||
        identity.nativeSource !== 'opencode:' + previous.store.actualPathDigest || identity.sourceGeneration !== hash(previous.store) ||
        identity.lineageKey !== previous.lineageKey || identity.epoch !== previous.store.sourceEpoch)
      throw new Error('Previous native final lost original root, source or EOF');
    const rawPage = JSON.parse(last.document);
    const page = NativeUsagePassPageSchema.parse(rawPage);
    const ack = NativeUsagePassAckSchema.parse(JSON.parse(last.ack));
    const body = { identity: rawPage.identity, ordinal: rawPage.ordinal, scanPositionBefore: rawPage.scanPositionBefore,
      scanPositionAfter: rawPage.scanPositionAfter, scannedRawRows: rawPage.scannedRawRows, counts: rawPage.counts,
      sessions: rawPage.sessions, steps: rawPage.steps, issues: rawPage.issues, eof: rawPage.eof };
    if (!page.eof || !isDeepStrictEqual(page.identity, identity) || !isDeepStrictEqual(ack.identity, identity) ||
        page.ordinal !== String(BigInt(pass.ordinal) - 1n) || page.payloadDigest !== hash(body) ||
        page.cumulativeDigest !== hash([page.previousDigest, page.payloadDigest]) ||
        pass.previous_digest !== page.cumulativeDigest || !isDeepStrictEqual(JSON.parse(pass.counts_json), page.counts) ||
        ack.ordinal !== page.ordinal || ack.payloadDigest !== page.payloadDigest || ack.cumulativeDigest !== page.cumulativeDigest ||
        !isDeepStrictEqual(ack.eof, page.eof) || BigInt(ack.sourceWatermark) > BigInt(this.binding.original(key).lastSequence))
      throw new Error('Previous final did not retain its original committed EOF and ACK');
    return pass.pass_id;
  }

  private header(value: string): { nativeAdmission: { lineageKey: string; resumeSessionId: string | null } } {
    const header = JSON.parse(value);
    if (header.nativeSource?.version !== 2 || !header.nativeAdmission || typeof header.nativeAdmission.lineageKey !== 'string')
      throw new Error('Original admission did not select native pages v2');
    return header;
  }
}
