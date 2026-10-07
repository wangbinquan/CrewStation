import type { Database } from 'bun:sqlite';
import type { DevelopmentNativeTurnInput } from '@crewstation/agent-drivers';
import type { NativeUsagePassOwner } from '@crewstation/agent-drivers';
import type { DevelopmentNativePreparation } from '@crewstation/contracts';
import { DevelopmentNativeJournal, type DevelopmentNativePageEvidence } from './developmentNativeJournal';
import { DevelopmentStartControls } from './developmentStartControls';
import { developmentIntentDigest } from './developmentStartIntent';
import { DevelopmentUsageStopReceiptSchema, type DevelopmentUsageStopReceipt } from '@crewstation/contracts';
import type { DevelopmentUsageAdmission, DevelopmentUsageEvent, DevelopmentUsageInfo, DevelopmentUsageInterruption, DevelopmentUsageKey, DevelopmentUsagePage, DevelopmentUsageReceipt, ProjectId, TaskId, DevelopmentRunnerUsageCapture } from '@crewstation/contracts';
import { DEVELOPMENT_USAGE_LIMITS, DevelopmentUsageAdmissionSchema, DevelopmentUsageEventSchema, DevelopmentUsageKeySchema, DevelopmentUsagePageSchema, DevelopmentUsageReceiptSchema, ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import { openJournalStorage } from '../exec/journalStorage';
import { bindDevelopmentJournal } from './developmentJournalBinding';

export interface DevelopmentJournalContext { runtimeTaskId: TaskId; workspaceTaskId: TaskId; projectId: ProjectId; podUid: string }
export interface DevelopmentJournalLimits { eventBytes: number; pageBytes: number }
interface Row { execution_id: string; incarnation: string; payload_digest: string; phase: DevelopmentUsageReceipt['phase']; last_sequence: number; acknowledged_sequence: number; result: string | null; spool_bytes: number; header: string }
interface EventRow { sequence: number; occurred_at: string; body: string }
function invalid(message: string): never { throw new RunnerCommandError('development_usage_invalid', message); }
const defaultLimits: DevelopmentJournalLimits = { eventBytes: DEVELOPMENT_USAGE_LIMITS.pageBytes, pageBytes: DEVELOPMENT_USAGE_LIMITS.pageBytes };

/** Numeric evidence has its own FULL/WAL store and cursor; ordinary text never enters it. */
export class DevelopmentUsageJournal {
  private readonly db: Database;
  private readonly trusted = new Map<string, DevelopmentUsageReceipt>();
  private readonly starts: DevelopmentStartControls;
  private readonly native: DevelopmentNativeJournal;
  readonly journalId: string;
  constructor(directory: string, readonly context: DevelopmentJournalContext, readonly incarnation: string, private readonly limits = defaultLimits) {
    if (!context.podUid || context.podUid.length > 128 || Object.values(limits).some((n) => !Number.isSafeInteger(n) || n < 1) || limits.eventBytes > limits.pageBytes || limits.pageBytes > DEVELOPMENT_USAGE_LIMITS.pageBytes) invalid('开发日志配置无效');
    TaskIdSchema.parse(context.runtimeTaskId); TaskIdSchema.parse(context.workspaceTaskId); ProjectIdSchema.parse(context.projectId); DevelopmentUsageKeySchema.shape.incarnation.parse(incarnation);
    this.db = openJournalStorage(directory);
    try {
      this.journalId = bindDevelopmentJournal(this.db, directory, context.podUid);
      this.db.exec('CREATE TABLE IF NOT EXISTS development_admissions (execution_id TEXT PRIMARY KEY, header TEXT NOT NULL);');
      this.starts = new DevelopmentStartControls(this.db);
      this.native = new DevelopmentNativeJournal(this.db, { incarnation, journalId: this.journalId, podUid: context.podUid,
        eventBytes: limits.eventBytes, pageBytes: limits.pageBytes,
        original: (key) => {
          if (bindDevelopmentJournal(this.db, directory, context.podUid) !== this.journalId) invalid('原生 journal marker 与原受理不同');
          const original = this.require(key), known = this.trusted.get(key.executionId) ?? this.receipt(original);
          return { header: original.header, incarnation: original.incarnation, phase: known.phase,
            interruption: known.interruption, lastSequence: original.last_sequence, acknowledgedSequence: original.acknowledged_sequence };
        },
        committed: (key) => { this.remember(this.receipt(this.require(key))); },
      });
      const row = this.row(context.runtimeTaskId);
      const admitted = this.db.query<{ count: number }, []>('SELECT count(*) AS count FROM executions').get()!.count;
      if (admitted > 1 || (admitted === 1 && !row)) throw new RunnerCommandError('development_journal_lost', '已受理开发日志的身份头或执行归属丢失');
      if (row) this.trusted.set(row.execution_id, this.receipt(row));
    } catch (error) { this.db.close(); throw error; }
  }

  reserve(raw: DevelopmentUsageAdmission): { created: boolean; receipt: DevelopmentUsageReceipt } {
    const admission = this.admission(raw);
    const reserved = this.db.transaction(() => this.reserveWithin(admission)).immediate();
    return { created: reserved.created, receipt: this.remember(reserved.receipt) };
  }

  requestStop(raw: DevelopmentUsageAdmission, podUid: string): DevelopmentUsageStopReceipt {
    const admission = this.admission(raw);
    if (podUid !== this.context.podUid || developmentIntentDigest(admission) !== admission.key.payloadDigest) invalid('停止命令与原意图或Pod不同');
    const receipt = this.db.transaction(() => {
      this.reserveWithin(admission);
      const row = this.require(admission.key), known = this.trusted.get(row.execution_id) ?? this.receipt(row);
      const prevented = this.starts.stop(row.execution_id, row.phase === 'registered' && row.incarnation === this.incarnation && known.phase !== 'finished');
      if (prevented && row.phase === 'registered' && known.phase !== 'finished') this.db.query('UPDATE executions SET phase=?,result=? WHERE execution_id=?').run('finished', JSON.stringify({ result: 'cancelled', interruption: known.interruption }), row.execution_id);
      return this.receipt(this.require(admission.key));
    }).immediate();
    this.remember(receipt);
    return this.stopStatus(admission.key, false);
  }

  permitLaunch(key: DevelopmentUsageKey): boolean {
    return this.db.transaction(() => {
      const row = this.require(key);
      if (row.incarnation !== this.incarnation) invalid('旧Runner实例不能获得新的启动许可');
      if (this.starts.get(key.executionId)?.stopRequested) return false;
      if (row.phase !== 'registered') invalid('只有未启动的原受理可获得启动许可');
      return this.starts.permit(key.executionId);
    }).immediate();
  }

  stopStatus(key: DevelopmentUsageKey, tracked: boolean): DevelopmentUsageStopReceipt {
    const receipt = this.remember(this.receipt(this.require(key))), control = this.starts.get(key.executionId);
    const state = control?.prevented && !control.launchPermitted && receipt.phase === 'finished' && receipt.result === 'cancelled' ? 'prevented'
      : receipt.phase === 'finished' && receipt.interruption === null ? 'finished'
      : tracked && control?.stopRequested && key.incarnation === this.incarnation && receipt.phase !== 'finished' ? 'stopping' : 'unknown';
    return DevelopmentUsageStopReceiptSchema.parse({ version: 1, state, receipt });
  }

  private admission(raw: DevelopmentUsageAdmission): DevelopmentUsageAdmission {
    const admission = DevelopmentUsageAdmissionSchema.parse(raw);
    this.key(admission.key);
    if (admission.intent.nativeSource?.version === 2 && developmentIntentDigest(admission) !== admission.key.payloadDigest) invalid('原生 v2 受理摘要与原启动意图不同');
    if (admission.intent.identity.projectId !== this.context.projectId || admission.intent.identity.taskId !== this.context.workspaceTaskId) invalid('开发受理不属于当前项目和父工作区');
    return admission;
  }

  private reserveWithin(admission: DevelopmentUsageAdmission): { created: boolean; receipt: DevelopmentUsageReceipt } {
    const identity = admission.intent.identity, prior = this.row(identity.executionId);
    if (prior) { this.match(prior, admission.key); return { created: false, receipt: this.receipt(prior) }; }
    if (admission.key.incarnation !== this.incarnation) invalid('新受理必须绑定当前 Runner 实例');
    const header = JSON.stringify({ identity, profileId: admission.intent.profileId, profileRevision: admission.intent.profileRevision, ...(admission.intent.nativeSource ? { nativeSource: admission.intent.nativeSource } : {}), ...(admission.intent.nativeSource?.version === 2 ? { nativeAdmission: { lineageKey: admission.intent.nativeUsageLineageKey, resumeSessionId: admission.intent.resumeSessionId } } : {}) });
    this.db.query('INSERT INTO executions(execution_id,attempt,payload_digest,incarnation,phase) VALUES(?,?,?,?,?)').run(identity.executionId, 1, admission.key.payloadDigest, this.incarnation, 'registered');
    this.db.query('INSERT INTO development_admissions(execution_id,header) VALUES(?,?)').run(identity.executionId, header);
    this.starts.register(identity.executionId);
    return { created: true, receipt: this.receipt(this.require(admission.key)) };
  }

  info(key?: DevelopmentUsageKey): DevelopmentUsageInfo {
    if (key) this.key(key);
    let receipt: DevelopmentUsageReceipt | null = null;
    try { const row = this.row(this.context.runtimeTaskId); if (row) { if (key) this.match(row, key); receipt = this.remember(this.receipt(row)); } else if (this.trusted.has(this.context.runtimeTaskId)) { throw new RunnerCommandError('development_journal_lost', '已受理的开发日志记录丢失'); } }
    catch (error) {
      const cached = this.trusted.get(this.context.runtimeTaskId);
      if (!cached || (error instanceof RunnerCommandError)) throw error;
      receipt = this.interrupt(cached.key.executionId, 'journal-unavailable');
      if (key && (receipt.key.incarnation !== key.incarnation || receipt.key.payloadDigest !== key.payloadDigest)) invalid('开发查询键与原受理不同');
    }
    return { version: 1, runtimeTaskId: this.context.runtimeTaskId, podUid: this.context.podUid, journalId: this.journalId, incarnation: this.incarnation, receipt };
  }

  running(key: DevelopmentUsageKey): void {
    const row = this.require(key);
    if (row.incarnation !== this.incarnation || row.phase !== 'registered') return;
    this.db.query('UPDATE executions SET phase=? WHERE execution_id=?').run('running', key.executionId);
    this.remember(this.receipt(this.row(key.executionId)!));
  }

  capture(key: DevelopmentUsageKey, capture: DevelopmentRunnerUsageCapture, occurredAt: string): void {
    this.key(key);
    const receipt = this.trusted.get(key.executionId);
    if (!receipt || receipt.key.incarnation !== key.incarnation || receipt.key.payloadDigest !== key.payloadDigest || key.incarnation !== this.incarnation) invalid('数值追加键与当前受理不同');
    if (receipt.interruption) return;
    const parsed = DevelopmentUsageEventSchema.safeParse({ sequence: (receipt?.lastSequence ?? 0) + 1, occurredAt, capture });
    if (!parsed.success) { this.interrupt(key.executionId, 'invalid-capture'); return; }
    const body = JSON.stringify(parsed.data.capture), bytes = Buffer.byteLength(JSON.stringify(parsed.data));
    try {
      this.db.transaction(() => {
        const row = this.require(key);
        if (row.incarnation !== this.incarnation || !['registered', 'running'].includes(row.phase)) invalid('不能向旧实例或已结束执行追加数值');
        if (parsed.data.capture.version !== 1) throw new RunnerCommandError('development_usage_invalid_capture', '原生 v2 帧只能由持久 owner 同事务追加');
        if (parsed.data.capture.nativeSource && JSON.parse(row.header).nativeSource?.version !== 1) throw new RunnerCommandError('development_usage_invalid_capture', '原意图未选择开发实际来源');
        if (bytes > this.limits.eventBytes || Buffer.byteLength(JSON.stringify({ key, after: row.last_sequence, through: row.last_sequence + 1, events: [parsed.data] })) > this.limits.pageBytes) throw new RunnerCommandError('development_usage_limit', '开发数值日志达到上限');
        this.db.query('INSERT INTO events(execution_id,sequence,occurred_at,body,bytes) VALUES(?,?,?,?,?)').run(key.executionId, row.last_sequence + 1, occurredAt, body, bytes);
        this.db.query('UPDATE executions SET last_sequence=last_sequence+1,spool_bytes=spool_bytes+? WHERE execution_id=?').run(bytes, key.executionId);
      }).immediate();
      this.remember(this.receipt(this.row(key.executionId)!));
    } catch (error) {
      const code = error instanceof RunnerCommandError ? error.code : '';
      this.interrupt(key.executionId, code === 'development_usage_limit' ? 'journal-limit' : code === 'development_usage_invalid_capture' ? 'invalid-capture' : 'journal-unavailable');
    }
  }

  finish(key: DevelopmentUsageKey, result: DevelopmentUsageReceipt['result']): void {
    if (result === null) invalid('结束回执必须有实际终态');
    this.key(key);
    const cached = this.trusted.get(key.executionId);
    if (!cached || cached.key.incarnation !== key.incarnation || cached.key.payloadDigest !== key.payloadDigest || key.incarnation !== this.incarnation) invalid('旧 Runner 或不同意图不能伪造完成');
    if (cached.phase === 'finished') { if (cached.result !== result) invalid('不能替换已知开发执行终态'); return; }
    try {
      this.require(key);
      this.db.query('UPDATE executions SET phase=?,result=? WHERE execution_id=?').run('finished', JSON.stringify({ result, interruption: cached?.interruption ?? null }), key.executionId);
      this.remember(this.receipt(this.row(key.executionId)!));
    } catch { const interrupted = this.interrupt(key.executionId, 'journal-unavailable'); this.trusted.set(key.executionId, { ...interrupted, phase: 'finished', result, finalThrough: null }); }
  }

  interrupt(executionId: string, reason: DevelopmentUsageInterruption): DevelopmentUsageReceipt {
    const prior = this.trusted.get(executionId);
    if (!prior) invalid('不能为未受理执行生成中断回执');
    const interrupted: DevelopmentUsageReceipt = { ...prior, interruption: prior.interruption ?? reason, finalThrough: null };
    this.trusted.set(executionId, interrupted);
    try {
      const row = this.row(executionId);
      if (row) this.db.query('UPDATE executions SET result=? WHERE execution_id=?').run(JSON.stringify({ result: row.phase === 'finished' ? interrupted.result : null, interruption: interrupted.interruption }), executionId);
    } catch { /* independent info control reply survives an append failure */ }
    return interrupted;
  }

  read(key: DevelopmentUsageKey, after: number, limit: number = DEVELOPMENT_USAGE_LIMITS.capturesPerPage): DevelopmentUsagePage {
    const row = this.require(key), trusted = this.trusted.get(key.executionId) ?? this.receipt(row);
    if (!Number.isSafeInteger(after) || after < row.acknowledged_sequence || after > trusted.lastSequence || !Number.isInteger(limit) || limit < 1 || limit > DEVELOPMENT_USAGE_LIMITS.capturesPerPage) invalid('开发数值读取范围无效或已确认');
    const rows = this.db.query<EventRow, [string, number, number, number]>('SELECT sequence,occurred_at,body FROM events WHERE execution_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?').all(key.executionId, after, trusted.lastSequence, limit);
    const events: DevelopmentUsageEvent[] = [];
    for (const event of rows) {
      let parsed: DevelopmentUsageEvent;
      try { parsed = DevelopmentUsageEventSchema.parse({ sequence: event.sequence, occurredAt: event.occurred_at, capture: JSON.parse(event.body) }); }
      catch { this.interrupt(key.executionId, 'journal-corrupt'); throw new RunnerCommandError('development_journal_lost', '开发数值记录已损坏，不能证明完整'); }
      if (parsed.sequence !== after + events.length + 1) { this.interrupt(key.executionId, 'journal-corrupt'); throw new RunnerCommandError('development_journal_lost', '开发数字序列存在不可取回缺口'); }
      const next = [...events, parsed];
      if (Buffer.byteLength(JSON.stringify({ key, after, through: event.sequence, events: next })) > this.limits.pageBytes) break;
      events.push(parsed);
    }
    if (after < trusted.lastSequence && events.length === 0) { this.interrupt(key.executionId, 'journal-corrupt'); throw new RunnerCommandError('development_journal_lost', '已声明的数字末尾无法读取'); }
    return DevelopmentUsagePageSchema.parse({ key, after, through: after + events.length, events });
  }

  acknowledge(key: DevelopmentUsageKey, through: number): DevelopmentUsageReceipt {
    const row = this.require(key), trusted = this.trusted.get(key.executionId) ?? this.receipt(row);
    if (!Number.isSafeInteger(through) || through < 0 || through > trusted.lastSequence) invalid('开发数字确认越过已持久水位');
    if (through <= row.acknowledged_sequence) return trusted;
    this.db.transaction(() => {
      const bytes = this.db.query<{ bytes: number }, [string, number]>('SELECT coalesce(sum(bytes),0) AS bytes FROM events WHERE execution_id=? AND sequence<=?').get(key.executionId, through)!.bytes;
      this.db.query('DELETE FROM events WHERE execution_id=? AND sequence<=?').run(key.executionId, through);
      this.db.query('UPDATE executions SET acknowledged_sequence=?,spool_bytes=max(0,spool_bytes-?) WHERE execution_id=?').run(through, bytes, key.executionId);
    }).immediate();
    return this.remember(this.receipt(this.row(key.executionId)!));
  }

  nativeBeginTurn(key: DevelopmentUsageKey, input: DevelopmentNativeTurnInput): void {
    this.key(key); this.native.beginTurn(key, input);
  }

  nativeTurnOwner(key: DevelopmentUsageKey, prepared: DevelopmentNativePreparation, rootCreatedAt: number | null): NativeUsagePassOwner {
    this.key(key); return this.native.turnOwner(key, prepared, rootCreatedAt);
  }

  nativeOwner(key: DevelopmentUsageKey, prepared: DevelopmentNativePreparation): NativeUsagePassOwner {
    this.key(key); return this.native.owner(key, prepared);
  }

  nativePage(key: DevelopmentUsageKey, passId: string, ordinal: string): DevelopmentNativePageEvidence {
    this.key(key); return this.native.readPage(key, passId, ordinal);
  }

  close(): void { this.db.close(); }
  private key(raw: DevelopmentUsageKey): void {
    const key = DevelopmentUsageKeySchema.parse(raw);
    if (key.executionId !== this.context.runtimeTaskId || key.journalId !== this.journalId) throw new RunnerCommandError('development_journal_lost', '开发日志身份与原受理不同');
  }
  private match(row: Row, key: DevelopmentUsageKey): void {
    if (row.incarnation !== key.incarnation || row.payload_digest !== key.payloadDigest) invalid('开发日志键与原启动意图不同');
  }
  private row(executionId: string): Row | null { return this.db.query<Row, [string]>('SELECT e.*, d.header FROM executions e JOIN development_admissions d ON e.execution_id=d.execution_id WHERE e.execution_id=?').get(executionId); }
  private require(key: DevelopmentUsageKey): Row { this.key(key); const row = this.row(key.executionId); if (!row) invalid('开发执行未受理'); this.match(row, key); return row; }
  private remember(receipt: DevelopmentUsageReceipt): DevelopmentUsageReceipt {
    const prior = this.trusted.get(receipt.key.executionId);
    if (prior && (prior.key.journalId !== receipt.key.journalId || prior.key.incarnation !== receipt.key.incarnation || prior.key.payloadDigest !== receipt.key.payloadDigest)) invalid('开发控制回执不能替换原受理');
    if (prior?.phase === 'finished' && receipt.phase === 'finished' && prior.result !== receipt.result) invalid('开发持久终态与已知终态冲突');
    const value = prior?.interruption ? { ...receipt, interruption: prior.interruption, finalThrough: null } : receipt;
    // A failed finish write leaves an older running row. This process still knows its real terminal.
    // On restart only durable rows are trusted, so that older row becomes unknown instead.
    if (prior?.phase === 'finished' && value.phase !== 'finished') { value.phase = 'finished'; value.result = prior.result; value.finalThrough = null; }
    this.trusted.set(value.key.executionId, value); return value;
  }
  private receipt(row: Row): DevelopmentUsageReceipt {
    const result = row.result ? JSON.parse(row.result) as { result: DevelopmentUsageReceipt['result']; interruption: DevelopmentUsageInterruption | null } : { result: null, interruption: null };
    const interrupted = result.interruption ?? (row.phase !== 'finished' && row.incarnation !== this.incarnation ? 'runner-restarted' : null);
    const { nativeSource: _nativeSource, nativeAdmission: _nativeAdmission, ...header } = JSON.parse(row.header) as Pick<DevelopmentUsageReceipt, 'identity' | 'profileId' | 'profileRevision'> & { nativeSource?: { version: 1 | 2 }; nativeAdmission?: { lineageKey: string; resumeSessionId: string | null } };
    if (header.identity.projectId !== this.context.projectId || header.identity.taskId !== this.context.workspaceTaskId || header.identity.executionId !== this.context.runtimeTaskId) throw new RunnerCommandError('development_journal_lost', '开发日志已绑定不同环境归属');
    return DevelopmentUsageReceiptSchema.parse({ ...header, key: { executionId: row.execution_id, journalId: this.journalId, incarnation: row.incarnation, payloadDigest: row.payload_digest }, podUid: this.context.podUid,
      phase: row.phase !== 'finished' && row.incarnation !== this.incarnation ? 'unknown' : row.phase,
      lastSequence: row.last_sequence, acknowledgedSequence: row.acknowledged_sequence, finalThrough: row.phase === 'finished' && !interrupted ? row.last_sequence : null,
      result: result.result, interruption: interrupted });
  }
}
