import { Database } from 'bun:sqlite';
import { nativePassIdentifier, nativePassPartFields } from './nativeUsagePassRows';
import type { NativePassPartRow, NativePassQueueRow, NativePassSessionRow } from './nativeUsagePassRows';

/** One original read snapshot, with connection-private disk-backed traversal state. */
export class NativeUsagePassStore {
  private readonly db: Database;
  private closed = false;
  readonly root: NativePassSessionRow;

  constructor(path: string, rootId: string) {
    this.db = new Database(path, { readonly: true });
    try { this.root = this.initialize(rootId); }
    catch (error) { this.close(); throw error; }
  }

  private initialize(rootId: string): NativePassSessionRow {
    this.db.query<unknown, []>('PRAGMA busy_timeout=0').get();
    this.db.query<unknown, []>('PRAGMA temp_store=FILE').get();
    this.db.query<unknown, []>('PRAGMA temp.cache_size=-8192').get();
    this.db.query<unknown, []>('BEGIN').get();
    const root = this.db.query<NativePassSessionRow, [string]>(
      'SELECT id,parent_id FROM session WHERE id=?',
    ).get(rootId);
    if (!root || !nativePassIdentifier(root.id)) throw new Error('Native root unavailable');
    this.db.query<unknown, []>(`CREATE TEMP TABLE native_pass_queue (
      id TEXT PRIMARY KEY,parent TEXT,entered INTEGER NOT NULL DEFAULT 0,parts_done INTEGER NOT NULL DEFAULT 0,
      part_after TEXT,child_after TEXT,done INTEGER NOT NULL DEFAULT 0)`).get();
    this.db.query<unknown, []>(
      'CREATE INDEX temp.native_pass_queue_pending ON native_pass_queue(done,id)',
    ).get();
    this.db.query<unknown, []>(`CREATE TEMP TABLE native_pass_open_steps (
      session TEXT NOT NULL,message TEXT NOT NULL,delta INTEGER NOT NULL,PRIMARY KEY(session,message))`).get();
    this.db.query<unknown, [string, string | null]>(
      'INSERT INTO temp.native_pass_queue(id,parent) VALUES (?,?)',
    ).get(root.id, null);
    return root;
  }

  queue(): NativePassQueueRow | null {
    return this.db.query<NativePassQueueRow, []>(`SELECT id,parent,entered,parts_done,part_after,child_after
      FROM temp.native_pass_queue WHERE done=0 ORDER BY id LIMIT 1`).get();
  }

  enter(id: string): void {
    this.db.query<unknown, [string]>(
      'UPDATE temp.native_pass_queue SET entered=1 WHERE id=?',
    ).get(id);
  }

  part(current: NativePassQueueRow): NativePassPartRow | null {
    // A nullable OR would rescan previous rows. Both original ranges use the actual composite index.
    return current.part_after === null
      ? this.db.query<NativePassPartRow, [string]>(
        nativePassPartFields + ' WHERE p.session_id=?1 ORDER BY p.id LIMIT 1',
      ).get(current.id)
      : this.db.query<NativePassPartRow, [string, string]>(
        nativePassPartFields + ' WHERE p.session_id=?1 AND p.id>?2 ORDER BY p.id LIMIT 1',
      ).get(current.id, current.part_after);
  }

  finishParts(id: string): boolean {
    const unfinished = this.db.query<{ message: string }, [string]>(
      'SELECT message FROM temp.native_pass_open_steps WHERE session=? AND delta>0 LIMIT 1',
    ).get(id) !== null;
    this.db.query<unknown, [string]>(
      'DELETE FROM temp.native_pass_open_steps WHERE session=?',
    ).get(id);
    this.db.query<unknown, [string]>(
      'UPDATE temp.native_pass_queue SET parts_done=1 WHERE id=?',
    ).get(id);
    return unfinished;
  }

  advancePart(current: NativePassQueueRow, row: NativePassPartRow): void {
    const delta = row.kind === 'step-start' ? 1 : row.kind === 'step-finish' ? -1 : 0;
    if (delta && nativePassIdentifier(row.message_id)) {
      this.db.query<unknown, [string, string, number]>(`INSERT INTO
        temp.native_pass_open_steps(session,message,delta) VALUES (?,?,?) ON CONFLICT(session,message)
        DO UPDATE SET delta=delta+excluded.delta`).get(current.id, row.message_id, delta);
    }
    this.db.query<unknown, [string, string]>(
      'UPDATE temp.native_pass_queue SET part_after=? WHERE id=?',
    ).get(row.id, current.id);
  }

  child(current: NativePassQueueRow): NativePassSessionRow | null {
    return current.child_after === null
      ? this.db.query<NativePassSessionRow, [string]>(
        'SELECT id,parent_id FROM session WHERE parent_id=?1 ORDER BY id LIMIT 1',
      ).get(current.id)
      : this.db.query<NativePassSessionRow, [string, string]>(
        'SELECT id,parent_id FROM session WHERE parent_id=?1 AND id>?2 ORDER BY id LIMIT 1',
      ).get(current.id, current.child_after);
  }

  advanceChild(current: NativePassQueueRow, child: NativePassSessionRow): boolean {
    const visited = this.db.query<{ id: string }, [string]>(
      'SELECT id FROM temp.native_pass_queue WHERE id=?',
    ).get(child.id);
    const conflict = visited !== null || child.parent_id !== current.id;
    if (!conflict) this.db.query<unknown, [string, string]>(
      'INSERT INTO temp.native_pass_queue(id,parent) VALUES (?,?)',
    ).get(child.id, current.id);
    this.db.query<unknown, [string, string]>(
      'UPDATE temp.native_pass_queue SET child_after=? WHERE id=?',
    ).get(child.id, current.id);
    return conflict;
  }

  finishQueue(id: string): void {
    this.db.query<unknown, [string]>(
      'UPDATE temp.native_pass_queue SET done=1 WHERE id=?',
    ).get(id);
  }

  commit(): void { this.db.query<unknown, []>('COMMIT').get(); }
  close(): void {
    if (!this.closed) { this.closed = true; this.db.close(); }
  }
}
