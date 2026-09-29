import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { RunnerCommandError, fsErrorCode } from '../commandError';

/** Bind this private store to one Pod. A missing marker after admission is loss, not a fresh start. */
export function bindDevelopmentJournal(db: Database, directory: string, podUid: string): string {
  const marker = join(directory, 'development.pod');
  try {
    const stat = lstatSync(marker);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 128 || readFileSync(marker, 'utf8') !== podUid) throw new RunnerCommandError('development_journal_lost', '开发日志 Pod 归属或私有标记已变化');
  } catch (error) {
    if (fsErrorCode(error) !== 'ENOENT') throw error;
    if (db.query<{ count: number }, []>('SELECT count(*) AS count FROM executions').get()!.count !== 0) throw new RunnerCommandError('development_journal_lost', '已受理的开发日志丢失了 Pod 标记');
    const fd = openSync(marker, 'wx', 0o600);
    try { writeFileSync(fd, podUid); fsyncSync(fd); } finally { closeSync(fd); }
    const parent = openSync(directory, 'r');
    try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  return db.query<{ identity: string }, []>('SELECT identity FROM journal_identity WHERE singleton=1').get()!.identity;
}
