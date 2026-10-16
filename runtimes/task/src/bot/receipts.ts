import { Database } from 'bun:sqlite';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { BotMessageReceipt } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { RunnerCommandError } from '../commandError';

/** Root-only journal; write-ahead dispatch markers survive response loss and Pod replacement. */
export class BotReceipts {
  private readonly db: Database;
  private readonly active = new Map<string, Promise<BotMessageReceipt>>();
  constructor(root: string) {
    const info = lstatSync(root);
    if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new RunnerCommandError('bot_journal_invalid', 'Bot 受理日志不可用');
    this.db = new Database(join(root, 'receipts.sqlite'), { create: true, strict: true });
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  }
  get(requestId: string): BotMessageReceipt | undefined {
    const row = this.db.query('SELECT body FROM receipts WHERE id=?').get(requestId) as { body: string } | null;
    return row ? JSON.parse(row.body) as BotMessageReceipt : undefined;
  }
  async dispatch(requestId: string, agentId: string, payload: unknown, send: () => Promise<void>): Promise<BotMessageReceipt> {
    const digest = jsonHash(payload), old = this.get(requestId);
    if (old) {
      if (old.digest !== digest || old.agentId !== agentId) throw new RunnerCommandError('bot_request_conflict', '消息标识已用于不同内容或执行');
      return this.active.get(requestId) ?? { ...old, state: old.state === 'dispatching' ? 'unknown' : old.state };
    }
    const receipt: BotMessageReceipt = { requestId, digest, agentId, state: 'dispatching' };
    this.save(receipt);
    const operation = (async () => {
      try { await send(); return this.save({ ...receipt, state: 'accepted' }); }
      catch (error) { return this.save({ ...receipt, state: 'unknown', error: error instanceof RunnerCommandError ? error.code : 'dispatch_failed' }); }
    })().finally(() => this.active.delete(requestId));
    this.active.set(requestId, operation);
    return operation;
  }
  private save(receipt: BotMessageReceipt): BotMessageReceipt {
    this.db.query('INSERT INTO receipts (id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(receipt.requestId, JSON.stringify(receipt));
    return receipt;
  }
  close(): void { this.db.close(); }
}
