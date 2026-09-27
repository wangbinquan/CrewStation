import type { Database } from 'bun:sqlite';
import type { RunnerBusinessMessageReceipt } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';

type Identity = Pick<RunnerBusinessMessageReceipt, 'executionId' | 'attempt' | 'messageId' | 'payloadDigest'>;
interface MessageRow { execution_id: string; message_id: string; attempt: number; payload_digest: string; incarnation: string; phase: RunnerBusinessMessageReceipt['phase']; error_code: string | null }

/** Never stores message text. A durable sending receipt precedes the non-transactional CLI write. */
export class MessageJournal {
  constructor(private readonly db: Database, private readonly incarnation: string) {
    db.exec(`CREATE TABLE IF NOT EXISTS messages (
      execution_id TEXT NOT NULL, message_id TEXT NOT NULL, attempt INTEGER NOT NULL, payload_digest TEXT NOT NULL,
      incarnation TEXT NOT NULL, phase TEXT NOT NULL, error_code TEXT, PRIMARY KEY(execution_id,message_id));`);
  }
  get(executionId: string, messageId: string): RunnerBusinessMessageReceipt | undefined {
    const row = this.db.query<MessageRow, [string, string]>('SELECT * FROM messages WHERE execution_id=? AND message_id=?').get(executionId, messageId);
    if (!row) return undefined;
    return { executionId: row.execution_id, attempt: row.attempt, messageId: row.message_id, payloadDigest: row.payload_digest, incarnation: row.incarnation,
      phase: row.phase === 'sending' && row.incarnation !== this.incarnation ? 'unknown' : row.phase, ...(row.error_code ? { errorCode: row.error_code } : {}) };
  }
  reserve(identity: Identity): { created: boolean; receipt: RunnerBusinessMessageReceipt } {
    return this.db.transaction(() => {
      const previous = this.get(identity.executionId, identity.messageId);
      if (previous) {
        if (previous.attempt !== identity.attempt || previous.payloadDigest !== identity.payloadDigest) throw new RunnerCommandError('idempotency_conflict', '消息 ID 已用于不同参数');
        return { created: false, receipt: previous };
      }
      if (this.db.query('SELECT 1 FROM messages WHERE execution_id=? AND phase IN (?,?) LIMIT 1').get(identity.executionId, 'sending', 'unknown')) throw new RunnerCommandError('message_in_flight', '上一条消息尚未确认');
      this.db.query('INSERT INTO messages(execution_id,message_id,attempt,payload_digest,incarnation,phase) VALUES(?,?,?,?,?,?)')
        .run(identity.executionId, identity.messageId, identity.attempt, identity.payloadDigest, this.incarnation, 'sending');
      return { created: true, receipt: this.get(identity.executionId, identity.messageId)! };
    }).immediate();
  }
  settle(identity: Identity, phase: 'delivered' | 'failed' | 'unknown', errorCode?: string): void {
    this.db.query('UPDATE messages SET phase=?,error_code=? WHERE execution_id=? AND message_id=? AND incarnation=? AND phase=?')
      .run(phase, errorCode ?? null, identity.executionId, identity.messageId, this.incarnation, 'sending');
  }
}
