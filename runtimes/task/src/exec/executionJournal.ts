import { MessageJournal } from './messageJournal';
import { BusinessExecutionFrameSchema, businessFrameOutputBytes } from '@crewstation/contracts';
import type { RunnerBusinessEvent, RunnerBusinessResult } from '@crewstation/contracts';
import type { Database } from 'bun:sqlite';
import { RunnerCommandError } from '../commandError';
import { openJournalStorage } from './journalStorage';

export interface ExecutionIdentity {
  executionId: string;
  attempt: number;
  payloadDigest: string;
}
export interface ExecutionReceipt extends ExecutionIdentity {
  incarnation: string;
  phase: 'registered' | 'running' | 'cancelling' | 'finished' | 'unknown';
  lastSequence: number;
  acknowledgedSequence: number;
  outputBytes: number;
  result: ExecutionResult | null;
}
export type ExecutionResult = RunnerBusinessResult;
export type ExecutionFrame = RunnerBusinessEvent['frame'];
export interface JournalEvent { sequence: number; occurredAt: string; frame: ExecutionFrame }
export interface JournalLimits { outputBytes: number; spoolBytes: number; eventBytes: number }
interface JournalRow {
  execution_id: string; attempt: number; payload_digest: string; incarnation: string;
  phase: ExecutionReceipt['phase']; last_sequence: number; acknowledged_sequence: number;
  output_bytes: number; spool_bytes: number; result: string | null;
}
interface EventRow { sequence: number; occurred_at: string; body: string }
const fail = (code: string, message: string): never => { throw new RunnerCommandError(code, message); };

/**
 * RFC-027 的 Runner 私有执行日志。调用者提供已隔离、持久挂载的 0700 目录；
 * 不保存 argv/env，启动意图先 FULL 同步提交，只有 reserve.created 才能 spawn。
 * SQLite 事务仅保护本地日志，不宣称它能和 OS spawn 原子提交。
 */
export class ExecutionJournal {
  private readonly db: Database;
  readonly messages: MessageJournal;

  constructor(directory: string, readonly incarnation: string, private readonly limits: JournalLimits) {
    if (!incarnation || Object.values(limits).some((n) => !Number.isSafeInteger(n) || n < 1)) fail('journal_configuration_invalid', '执行日志配置无效');
    this.db = openJournalStorage(directory);
    this.messages = new MessageJournal(this.db, incarnation);
  }

  reserve(identity: ExecutionIdentity): { created: boolean; receipt: ExecutionReceipt } {
    if (!identity.executionId || !Number.isSafeInteger(identity.attempt) || identity.attempt < 1 || !/^[a-f0-9]{64}$/.test(identity.payloadDigest)) fail('invalid_execution', '执行标识或摘要无效');
    return this.db.transaction(() => {
      const prior = this.row(identity.executionId);
      if (prior) {
        if (prior.attempt !== identity.attempt || prior.payload_digest !== identity.payloadDigest) fail('execution_conflict', '执行 ID 已登记不同的尝试或参数');
        return { created: false, receipt: this.receipt(prior) };
      }
      this.db.query('INSERT INTO executions(execution_id,attempt,payload_digest,incarnation,phase) VALUES(?,?,?,?,?)')
        .run(identity.executionId, identity.attempt, identity.payloadDigest, this.incarnation, 'registered');
      return { created: true, receipt: this.receipt(this.required(identity.executionId)) };
    }).immediate();
  }

  get(executionId: string): ExecutionReceipt | undefined {
    const row = this.row(executionId);
    return row ? this.receipt(row) : undefined;
  }

  /** 状态和其事件一次提交；finished 永不复活。取消请求不等同于已经停止。 */
  state(executionId: string, state: 'running' | 'cancelling'): ExecutionReceipt {
    return this.db.transaction(() => {
      const row = this.owned(executionId);
      if (row.phase === state || row.phase === 'finished') return this.receipt(row);
      if (state === 'running' && row.phase !== 'registered') fail('execution_conflict', '执行不能重新进入 running');
      this.append(row, { type: 'state', state }, 0, true);
      this.db.query('UPDATE executions SET phase=? WHERE execution_id=?').run(state, executionId);
      return this.receipt(this.required(executionId));
    }).immediate();
  }

  output(executionId: string, stream: 'stdout' | 'stderr', text: string): JournalEvent {
    return this.db.transaction(() => {
      const row = this.owned(executionId);
      if (row.phase !== 'running' && row.phase !== 'cancelling') fail('execution_conflict', '只有活动执行可以追加输出');
      return this.append(row, { type: 'output', stream, text }, Buffer.byteLength(text), false);
    }).immediate();
  }

  agent(executionId: string, raw: Extract<ExecutionFrame, { type: 'agent' }>['event']): JournalEvent {
    const frame = BusinessExecutionFrameSchema.parse({ type: 'agent', event: raw });
    return this.db.transaction(() => {
      const row = this.owned(executionId);
      if (row.phase !== 'running' && row.phase !== 'cancelling') fail('execution_conflict', '只有活动执行可以追加 Agent 事件');
      return this.append(row, frame, businessFrameOutputBytes(frame), false);
    }).immediate();
  }

  /** 必须在进程退出、两条输出管道读尽后调用；结果和最后水位同一事务持久化。 */
  finish(executionId: string, result: ExecutionResult): ExecutionReceipt {
    return this.db.transaction(() => {
      const row = this.owned(executionId);
      if (row.phase === 'finished') return this.receipt(row);
      this.append(row, { type: 'result', result }, 0, true);
      this.db.query('UPDATE executions SET phase=?,result=? WHERE execution_id=?').run('finished', JSON.stringify(result), executionId);
      return this.receipt(this.required(executionId));
    }).immediate();
  }

  replay(executionId: string, after: number, limit = 200): JournalEvent[] {
    const row = this.required(executionId);
    if (!Number.isSafeInteger(after) || after < row.acknowledged_sequence || after > row.last_sequence) fail('execution_cursor_invalid', '游标超出 Runner 尚保留的事件范围');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('execution_cursor_invalid', '分页大小必须为 1～1000');
    const result: JournalEvent[] = [];
    let bytes = 0;
    // 中途截断游标会结束 statement，不能复用 db.query 的缓存 statement。
    const query = this.db.prepare<EventRow, [string, number, number]>('SELECT sequence,occurred_at,body FROM events WHERE execution_id=? AND sequence>? ORDER BY sequence LIMIT ?');
    try {
      for (const event of query.iterate(executionId, after, limit)) {
        bytes += Buffer.byteLength(event.body) + 128;
        if (result.length > 0 && bytes > 1024 * 1024) break;
        result.push({ sequence: event.sequence, occurredAt: event.occurred_at, frame: JSON.parse(event.body) as ExecutionFrame });
      }
    } finally { query.finalize(); }
    return result;
  }

  /** 仅接受 session 已持久化的连续水位；不删除幂等墓碑和结果摘要。 */
  acknowledge(executionId: string, through: number): void {
    this.db.transaction(() => {
      const row = this.required(executionId);
      if (!Number.isSafeInteger(through) || through < 0 || through > row.last_sequence) fail('execution_cursor_invalid', '确认水位尚未产生');
      if (through <= row.acknowledged_sequence) return;
      this.db.query('DELETE FROM events WHERE execution_id=? AND sequence<=?').run(executionId, through);
      this.db.query('UPDATE executions SET acknowledged_sequence=?,spool_bytes=(SELECT COALESCE(SUM(bytes),0) FROM events WHERE execution_id=?) WHERE execution_id=?').run(through, executionId, executionId);
    }).immediate();
  }

  /** Loss of a process/stream handle is not termination proof, even in the same Runner incarnation. */
  unknown(executionId: string): void {
    this.db.transaction(() => {
      const row = this.owned(executionId);
      if (row.phase !== 'finished') this.db.query('UPDATE executions SET phase=? WHERE execution_id=?').run('unknown', executionId);
    }).immediate();
  }

  close(): void { this.db.close(); }

  private row(id: string): JournalRow | null { return this.db.query<JournalRow, [string]>('SELECT * FROM executions WHERE execution_id=?').get(id); }
  private required(id: string): JournalRow { return this.row(id) ?? fail('execution_not_found', '执行记录不存在'); }
  private owned(id: string): JournalRow {
    const row = this.required(id);
    if (row.incarnation !== this.incarnation) fail('execution_unknown', '旧 Runner 的执行只能查询，不能按旧 PID 重启或改写');
    return row;
  }
  private receipt(row: JournalRow): ExecutionReceipt {
    return { executionId: row.execution_id, attempt: row.attempt, payloadDigest: row.payload_digest, incarnation: row.incarnation,
      phase: row.phase !== 'finished' && row.incarnation !== this.incarnation ? 'unknown' : row.phase,
      lastSequence: row.last_sequence, acknowledgedSequence: row.acknowledged_sequence, outputBytes: row.output_bytes,
      result: row.result ? JSON.parse(row.result) as ExecutionResult : null };
  }
  private append(row: JournalRow, frame: ExecutionFrame, outputBytes: number, control: boolean): JournalEvent {
    const body = JSON.stringify(frame), bytes = Buffer.byteLength(body);
    // 控制事件最多 running、cancelling、result 三条，独立预留，输出触顶仍能留下失败原因。
    if (!control && (bytes > this.limits.eventBytes || row.output_bytes + outputBytes > this.limits.outputBytes)) fail('output_limit', '执行输出达到上限');
    if (!control && row.spool_bytes + bytes > this.limits.spoolBytes) fail('event_persistence_failed', '未确认事件积压达到上限');
    const event = { sequence: row.last_sequence + 1, occurredAt: new Date().toISOString(), frame };
    this.db.query('INSERT INTO events(execution_id,sequence,occurred_at,body,bytes) VALUES(?,?,?,?,?)').run(row.execution_id, event.sequence, event.occurredAt, body, bytes);
    this.db.query('UPDATE executions SET last_sequence=?,output_bytes=output_bytes+?,spool_bytes=spool_bytes+? WHERE execution_id=?')
      .run(event.sequence, outputBytes, bytes, row.execution_id);
    return event;
  }
}
