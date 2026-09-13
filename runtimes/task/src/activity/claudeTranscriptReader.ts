import { open } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { parseClaudeTranscriptNode, type ClaudeTranscriptNode } from '@crewstation/agent-drivers';

interface Cursor { path: string; offset: number; pending: string; decoder: TextDecoder; inode?: number; exists: boolean }
const CHUNK = 256 * 1024;
const MAX_LINE = 2 * 1024 * 1024;

/** 每次最多读 1 MiB，保留半行与 UTF-8 边界；重写、解析失败或超大记录只降低状态可信度。 */
export class ClaudeTranscriptReader {
  private readonly cursors = new Map<string, Cursor>();
  private serial = Promise.resolve();
  private closed = false;
  constructor(private readonly emit: (node: ClaudeTranscriptNode) => void, private readonly unavailable: () => void) {}

  track(sessionId: string, path: string): void {
    if (this.closed) return;
    if (!isAbsolute(path) || basename(path) !== `${sessionId}.jsonl`) { this.fail(); return; }
    const existing = this.cursors.get(sessionId);
    if (existing) { if (existing.path !== path) this.fail(); return; }
    if (this.cursors.size >= 128) { this.fail(); return; }
    this.cursors.set(sessionId, { path, offset: 0, pending: '', decoder: new TextDecoder('utf-8', { fatal: true }), exists: false });
  }

  read(): Promise<void> {
    this.serial = this.serial.then(async () => {
      if (this.closed) return;
      for (const [session, cursor] of this.cursors) await this.readCursor(session, cursor);
    }).catch(() => { this.fail(); });
    return this.serial;
  }

  close(): void { this.closed = true; this.cursors.clear(); }
  private fail(): void { if (this.closed) return; this.close(); this.unavailable(); }

  private async readCursor(session: string, cursor: Cursor): Promise<void> {
    let file;
    try { file = await open(cursor.path, 'r'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || cursor.exists) this.fail();
      return;
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < cursor.offset || (cursor.inode !== undefined && cursor.inode !== stat.ino)) { this.fail(); return; }
      cursor.inode = stat.ino; cursor.exists = true;
      for (let count = 0; count < 4 && cursor.offset < stat.size && !this.closed; count++) {
        const buffer = new Uint8Array(Math.min(CHUNK, stat.size - cursor.offset));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, cursor.offset);
        if (!bytesRead) break;
        cursor.offset += bytesRead;
        this.consume(session, cursor, cursor.decoder.decode(buffer.subarray(0, bytesRead), { stream: true }));
      }
    } finally { await file.close(); }
  }

  private consume(session: string, cursor: Cursor, content: string): void {
    const lines = (cursor.pending + content).split('\n');
    cursor.pending = lines.pop()!;
    if (Buffer.byteLength(cursor.pending) > MAX_LINE) throw new Error('Native transcript record exceeds observer capacity');
    for (const line of lines) {
      if (!line.trim()) continue;
      if (Buffer.byteLength(line) > MAX_LINE) throw new Error('Native transcript record exceeds observer capacity');
      const node = parseClaudeTranscriptNode(JSON.parse(line));
      if (!node) continue;
      if (node.sessionId !== session) throw new Error('Native transcript session changed');
      this.emit(node);
    }
  }
}
