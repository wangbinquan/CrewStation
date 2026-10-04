import { createHash } from 'node:crypto';
import { nativePassIdentifier, nativePassMeasurement } from './nativeUsagePassRows';
import type { NativePassQueueRow } from './nativeUsagePassRows';
import type { NativeUsagePassStore } from './nativeUsagePassStore';
import type { NativeUsagePassCounts, NativeUsagePassSession, NativeUsagePassStep } from './nativeUsagePassTypes';

interface NativePassPageWork {
  sessions: NativeUsagePassSession[]; steps: NativeUsagePassStep[];
  scanned: number; payloadBytes: number; pageBytes: number;
}

function fits(work: NativePassPageWork, value: unknown, message: string): boolean {
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > work.pageBytes) throw new Error(message);
  return work.payloadBytes + bytes <= work.pageBytes;
}

/** Each source row advances once; packet sizes affect work only, never the source population. */
export class NativeUsagePassScan {
  private readonly issues = new Set<string>();
  private readonly fingerprint = createHash('sha256');
  private sessionsRead = 0n;
  private partsRead = 0n;
  private stepsRead = 0n;
  private position = 0n;

  constructor(private readonly store: NativeUsagePassStore) {
    this.fingerprint.update(JSON.stringify(['root', store.root]));
  }

  private counts(): NativeUsagePassCounts {
    return { sessions: this.sessionsRead.toString(), parts: this.partsRead.toString(), steps: this.stepsRead.toString() };
  }

  private record(kind: string, row: unknown, work: NativePassPageWork): void {
    this.fingerprint.update(JSON.stringify([kind, row]));
    this.position++; work.scanned++;
  }

  private enter(current: NativePassQueueRow, work: NativePassPageWork): boolean {
    const node = { id: current.id, parentSessionId: current.parent };
    if (!fits(work, node, 'Native session exceeds packet capacity')) return false;
    work.sessions.push(node); work.payloadBytes += Buffer.byteLength(JSON.stringify(node));
    this.sessionsRead++; this.record('session', node, work); this.store.enter(current.id);
    return true;
  }

  private part(current: NativePassQueueRow, work: NativePassPageWork): boolean {
    const row = this.store.part(current);
    if (!row) {
      if (this.store.finishParts(current.id)) this.issues.add('native-step-unfinished');
      return true;
    }
    if (!nativePassIdentifier(row.id)) throw new Error('Native part cursor unavailable');
    if ((row.kind === 'step-start' || row.kind === 'step-finish')
      && !nativePassIdentifier(row.message_id)) {
      throw new Error('Native step message identity unavailable');
    }
    const validFinish = row.kind === 'step-finish' && nativePassIdentifier(row.message_id)
      && row.session_id === current.id;
    const value = validFinish ? nativePassMeasurement(row, current.parent, this.issues) : undefined;
    if (value && !fits(work, value, 'Native numeric row exceeds packet capacity')) return false;
    this.record('part', row, work); this.partsRead++;
    if (row.kind === 'step-finish') {
      this.stepsRead++;
      if (!validFinish) this.issues.add('native-step-identity');
      else if (value) {
        work.steps.push(value); work.payloadBytes += Buffer.byteLength(JSON.stringify(value));
      }
    }
    this.store.advancePart(current, row);
    return true;
  }

  private child(current: NativePassQueueRow, work: NativePassPageWork): boolean {
    const child = this.store.child(current);
    if (!child) { this.store.finishQueue(current.id); return true; }
    if (!nativePassIdentifier(child.id)) throw new Error('Native child cursor unavailable');
    this.record('child', child, work);
    if (this.store.advanceChild(current, child)) this.issues.add('native-tree-conflict');
    return true;
  }

  page(pageRows: number, pageBytes: number) {
    const before = this.position.toString();
    const work: NativePassPageWork = { sessions: [], steps: [], scanned: 0, payloadBytes: 0, pageBytes };
    let eof = false;
    while (work.scanned < pageRows && work.payloadBytes < pageBytes) {
      const current = this.store.queue();
      if (!current) { eof = true; break; }
      const advanced = !current.entered ? this.enter(current, work)
        : !current.parts_done ? this.part(current, work) : this.child(current, work);
      if (!advanced) break;
    }
    const counts = this.counts();
    return {
      scanPositionBefore: before, scanPositionAfter: this.position.toString(),
      scannedRawRows: String(work.scanned), counts, sessions: work.sessions, steps: work.steps,
      issues: [...this.issues].sort(),
      eof: eof ? { fingerprint: this.fingerprint.digest('hex'), counts } : null,
    };
  }
}
