import type { RunnerEvent, RunnerHello } from '@crewstation/contracts';
import { PendingCommands } from './pendingCommands';

export interface EventSink {
  send(frame: string): void;
}

/** 一个 TaskRunner 的在线连接：hello 信息、待回复命令、最后收到的 seq、订阅它的浏览器流。 */
export class RunnerConnection {
  readonly pending: PendingCommands;
  readonly subscribers = new Set<EventSink>();
  lastSeq: number;
  lastSeenAt: number;

  constructor(readonly hello: RunnerHello, readonly socket: EventSink, resumeFromSeq: number, commandTimeoutMs: number, now: number) {
    this.pending = new PendingCommands(commandTimeoutMs);
    this.lastSeq = resumeFromSeq;
    this.lastSeenAt = now;
  }

  /** 重放期间可能收到已处理过的 seq；只接受严格递增。 */
  accept(seq: number, now: number): boolean {
    this.lastSeenAt = now;
    if (seq <= this.lastSeq) return false;
    this.lastSeq = seq;
    return true;
  }

  broadcast(frame: string): void {
    for (const subscriber of this.subscribers) {
      try { subscriber.send(frame); } catch { this.subscribers.delete(subscriber); }
    }
  }

  static frameOf(seq: number, at: string, event: RunnerEvent): string {
    return JSON.stringify({ type: 'event', seq, at, event });
  }
}
