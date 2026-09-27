import { Database } from 'bun:sqlite';
import { lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeInitializationStatus } from '@crewstation/contracts';
import { RuntimeInitializationStatusSchema } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';

/** 每 Pod 独占 emptyDir，目录归 Runner、worker 不可写；启动意图先同步落盘再执行副作用。 */
export class InitializationJournal {
  private readonly db: Database;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const info = lstatSync(directory);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new RunnerCommandError('initialization_journal_unsafe', '初始化日志目录必须由 Runner 独占');
    const filename = join(directory, 'initialization.sqlite');
    try {
      const file = lstatSync(filename);
      if (!file.isFile() || file.uid !== info.uid || (file.mode & 0o022) !== 0) throw new RunnerCommandError('initialization_journal_unsafe', '初始化日志文件不安全');
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    this.db = new Database(filename, { create: true, strict: true });
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=2000; CREATE TABLE IF NOT EXISTS initialization (execution_id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
  }
  read(id: string): RuntimeInitializationStatus | undefined {
    const row = this.db.query<{ payload: string }, [string]>('SELECT payload FROM initialization WHERE execution_id=?').get(id);
    return row ? RuntimeInitializationStatusSchema.parse(JSON.parse(row.payload)) : undefined;
  }
  reserve(state: RuntimeInitializationStatus): { created: boolean; state: RuntimeInitializationStatus } {
    return this.db.transaction(() => {
      const old = this.read(state.executionId!);
      if (old) return { created: false, state: old };
      this.db.query('INSERT INTO initialization(execution_id,payload) VALUES(?,?)').run(state.executionId!, JSON.stringify(state));
      return { created: true, state };
    })();
  }
  write(state: RuntimeInitializationStatus): void {
    RuntimeInitializationStatusSchema.parse(state);
    this.db.query('UPDATE initialization SET payload=? WHERE execution_id=?').run(JSON.stringify(state), state.executionId!);
  }
  close(): void { this.db.close(); }
}
