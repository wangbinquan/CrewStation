import type { RunnerCommand, RunnerEvent, RunnerHello, SessionMessage } from '@crewstation/contracts';
import { SessionMessageSchema } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { BackoffPolicy, IdleWatchdog, RawFrame } from '@crewstation/ws';
import { ReconnectingWebSocketClient, ReplayBuffer, createIdleWatchdog, decodeFrame, encodeFrame, peekFrameField } from '@crewstation/ws';

export interface SessionLinkOptions {
  url: string;
  hello: () => RunnerHello;
  replayCapacity: number;
  idleTimeoutMs: number;
  backoff: Partial<BackoffPolicy>;
  onCommand: (command: RunnerCommand) => void;
  logger: Logger;
}

export interface SessionLink {
  start(): void;
  /** 等待发送队列写出；退出前调用，尾部事件（agent cancelled、terminalClosed）才不会丢。 */
  flush(timeoutMs?: number): Promise<boolean>;
  close(): void;
  /** 事件带单调递增 seq 进入重放缓冲；已握手时立即发送，否则等 welcome 后补发。返回该事件的 seq。 */
  emit(event: RunnerEvent): number;
  reply(id: string, payload: unknown): void;
  fail(id: string, code: string, message: string): void;
  readonly welcomed: boolean;
  readonly lastSeq: number;
  /** 首次收到 welcome 时 resolve。 */
  whenReady(): Promise<void>;
}

/** 断线期间完成的命令结果没有 seq，无法按游标重放；有界暂存、握手后一次性补发，超出上限丢最旧的。 */
const MAX_PENDING_REPLIES = 1000;

export function createSessionLink(options: SessionLinkOptions): SessionLink {
  return new WebSocketSessionLink(options);
}

class WebSocketSessionLink implements SessionLink {
  private readonly buffer: ReplayBuffer<string>;
  private readonly pendingReplies: string[] = [];
  private readonly client: ReconnectingWebSocketClient;
  private readonly watchdog: IdleWatchdog;
  private readonly logger: Logger;
  private readonly ready: Promise<void>;
  private resolveReady: (() => void) | undefined;
  private seq = 0;
  private welcomedValue = false;

  constructor(private readonly options: SessionLinkOptions) {
    this.logger = options.logger;
    this.buffer = new ReplayBuffer<string>(options.replayCapacity);
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
    this.watchdog = createIdleWatchdog({
      timeoutMs: Math.max(1, options.idleTimeoutMs),
      onTimeout: () => {
        this.logger.warn('no frame from cs-session within idle timeout, reconnecting', { idleTimeoutMs: options.idleTimeoutMs });
        this.client.reconnectNow('idle timeout');
      },
    });
    this.client = new ReconnectingWebSocketClient({
      url: options.url,
      backoff: options.backoff,
      logger: this.logger,
      onOpen: () => this.onOpen(),
      onMessage: (raw) => this.onFrame(raw),
      onClose: (info) => {
        this.welcomedValue = false;
        this.watchdog.stop();
        this.logger.warn('session link closed', { code: info.code, reason: info.reason, willReconnect: info.willReconnect });
      },
      onError: (error) => this.logger.debug('session link socket error', { error: describeError(error) }),
    });
  }

  get welcomed(): boolean {
    return this.welcomedValue;
  }

  get lastSeq(): number {
    return this.seq;
  }

  start(): void {
    this.client.connect();
  }

  /** 等待发送队列写出；退出前调用，尾部事件（agent cancelled、terminalClosed）才不会丢。 */
  flush(timeoutMs?: number): Promise<boolean> {
    return this.client.flush(timeoutMs);
  }

  close(): void {
    this.watchdog.stop();
    this.client.close(1000, 'runner shutdown');
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  emit(event: RunnerEvent): number {
    this.seq += 1;
    const frame = encodeFrame({ type: 'event', seq: this.seq, at: new Date().toISOString(), event });
    this.buffer.push(this.seq, frame);
    if (this.welcomedValue) this.sendRaw(frame);
    return this.seq;
  }

  reply(id: string, payload: unknown): void {
    this.sendReply(encodeFrame({ type: 'result', id, payload }));
  }

  fail(id: string, code: string, message: string): void {
    this.sendReply(encodeFrame({ type: 'error', id, code, message }));
  }

  private onOpen(): void {
    this.welcomedValue = false;
    this.sendRaw(encodeFrame(this.options.hello()));
    this.logger.info('session link connected, hello sent', { lastSeq: this.seq });
  }

  private onFrame(raw: RawFrame): void {
    this.watchdog.touch();
    const decoded = decodeFrame(raw, SessionMessageSchema);
    if (!decoded.ok) {
      this.rejectFrame(raw, decoded.error.message);
      return;
    }
    const message: SessionMessage = decoded.value;
    if (message.type === 'welcome') {
      this.onWelcome(message.resumeFromSeq);
      return;
    }
    if (message.type === 'ping') {
      this.sendRaw(encodeFrame({ type: 'pong', at: new Date().toISOString() }));
      return;
    }
    if (!this.welcomedValue) this.logger.warn('command received before welcome', { type: message.type, id: message.id });
    this.options.onCommand(message);
  }

  private onWelcome(resumeFromSeq: number): void {
    this.welcomedValue = true;
    if (!this.buffer.canReplayFrom(resumeFromSeq)) {
      this.logger.warn('replay gap: events before the buffer start were evicted', { resumeFromSeq, firstBuffered: this.buffer.firstSeq });
    }
    const entries = this.buffer.since(resumeFromSeq);
    for (const entry of entries) this.sendRaw(entry.item);
    for (const frame of this.pendingReplies.splice(0)) this.sendRaw(frame);
    this.logger.info('welcome received', { resumeFromSeq, replayed: entries.length, lastSeq: this.seq });
    if (this.options.idleTimeoutMs > 0) this.watchdog.start();
    this.resolveReady?.();
    this.resolveReady = undefined;
  }

  private rejectFrame(raw: RawFrame, reason: string): void {
    const id = peekFrameField(raw, 'id');
    const type = peekFrameField(raw, 'type');
    const summary = reason.slice(0, 500);
    if (type === 'welcome') this.logger.error('welcome frame rejected: protocol version mismatch?', { reason: summary });
    else this.logger.warn('invalid frame from cs-session', { type, hasId: id !== undefined, reason: summary });
    if (id !== undefined) this.sendReply(encodeFrame({ type: 'error', id, code: 'invalid_command', message: `命令帧不合协议：${summary}` }));
  }

  private sendRaw(frame: string): boolean {
    try {
      this.client.send(frame);
      return true;
    } catch (error) {
      this.logger.debug('frame not sent: link down', { error: describeError(error) });
      return false;
    }
  }

  private sendReply(frame: string): void {
    if (this.welcomedValue && this.sendRaw(frame)) return;
    if (this.pendingReplies.length >= MAX_PENDING_REPLIES) this.pendingReplies.shift();
    this.pendingReplies.push(frame);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'type' in error) return String((error as { type: unknown }).type);
  return String(error);
}
