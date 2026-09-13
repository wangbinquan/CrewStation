import type { Logger } from '@crewstation/kernel';
import { noopLogger } from '@crewstation/kernel';
import type { BackoffPolicy } from './backoff';
import { DEFAULT_BACKOFF, backoffDelayMs } from './backoff';
import type { RawFrame } from './frames';

export type ClientState = 'idle' | 'connecting' | 'open' | 'waiting' | 'closed';

export interface CloseInfo {
  code: number;
  reason: string;
  willReconnect: boolean;
}

export interface ReconnectingClientOptions {
  url: string;
  backoff?: Partial<BackoffPolicy>;
  /** 连续失败次数上限；缺省无限重连。 */
  maxAttempts?: number;
  onOpen?: () => void;
  onMessage?: (data: RawFrame) => void;
  onClose?: (info: CloseInfo) => void;
  onError?: (error: unknown) => void;
  /** 测试钩子；缺省使用全局 WebSocket。 */
  createSocket?: (url: string) => WebSocket;
  logger?: Logger;
}

type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * 断线自动重连的 WebSocket 客户端：指数退避带抖动，`send` 在未连接时抛错而不是静默丢帧，
 * `close()` 之后不再重连。重放与心跳语义由调用方在回调里组合（见 ReplayBuffer、createIdleWatchdog）。
 */
export class ReconnectingWebSocketClient {
  private socket: WebSocket | undefined;
  private timer: TimerHandle | undefined;
  private stateValue: ClientState = 'idle';
  private attemptsValue = 0;
  private readonly policy: BackoffPolicy;
  private readonly logger: Logger;

  constructor(private readonly options: ReconnectingClientOptions) {
    this.policy = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.logger = options.logger ?? noopLogger;
  }

  get state(): ClientState {
    return this.stateValue;
  }

  /** 自上次成功连接以来的连续失败次数。 */
  get attempts(): number {
    return this.attemptsValue;
  }

  connect(): void {
    if (this.stateValue !== 'idle' && this.stateValue !== 'waiting') return;
    this.clearTimer();
    this.open();
  }

  send(data: string | ArrayBufferLike | Uint8Array): void {
    if (this.stateValue !== 'open' || this.socket === undefined) throw new Error(`WebSocket 未连接（状态 ${this.stateValue}）`);
    // WebSocket 的浏览器类型只接受 ArrayBuffer；保留调用方的共享缓冲支持，发送独立字节快照。
    this.socket.send(typeof data === 'string' ? data : (data instanceof Uint8Array ? data : new Uint8Array(data)).slice());
  }

  /**
   * 等待已排队的帧真正写出（bufferedAmount 归零），最多等 timeoutMs。
   * 退出前调用，避免 close() 紧跟 process.exit 把尾部事件丢在发送队列里。
   */
  async flush(timeoutMs = 2000): Promise<boolean> {
    const socket = this.socket;
    if (socket === undefined) return true;
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (socket.bufferedAmount > 0) {
      if (Date.now() >= deadline) return false;
      await Bun.sleep(10);
    }
    return true;
  }

  /** 主动丢弃当前连接并按退避重连（例如看门狗判定对端失联）。 */
  reconnectNow(reason = 'reconnect requested'): void {
    if (this.stateValue === 'closed') return;
    const socket = this.socket;
    this.socket = undefined;
    this.clearTimer();
    try {
      socket?.close(4000, reason);
    } catch (error) {
      this.logger.debug('close before reconnect failed', { error: String(error) });
    }
    if (socket !== undefined) this.options.onClose?.({ code: 4000, reason, willReconnect: true });
    this.scheduleReconnect();
  }

  /** 永久关闭：不再重连。 */
  close(code = 1000, reason = 'client closed'): void {
    const wasOpen = this.socket !== undefined;
    this.stateValue = 'closed';
    this.clearTimer();
    const socket = this.socket;
    this.socket = undefined;
    try {
      socket?.close(code, reason);
    } catch (error) {
      this.logger.debug('close failed', { error: String(error) });
    }
    if (wasOpen) this.options.onClose?.({ code, reason, willReconnect: false });
  }

  private open(): void {
    this.stateValue = 'connecting';
    let socket: WebSocket;
    try {
      socket = (this.options.createSocket ?? ((url: string) => new WebSocket(url)))(this.options.url);
    } catch (error) {
      this.options.onError?.(error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.stateValue = 'open';
      this.attemptsValue = 0;
      this.options.onOpen?.();
    });
    socket.addEventListener('message', (event) => {
      if (this.socket === socket) this.options.onMessage?.(event.data as RawFrame);
    });
    socket.addEventListener('error', (event) => {
      if (this.socket === socket) this.options.onError?.(event);
    });
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      const willReconnect = this.stateValue !== 'closed';
      this.options.onClose?.({ code: event.code, reason: event.reason, willReconnect });
      if (willReconnect) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stateValue === 'closed') return;
    if (this.options.maxAttempts !== undefined && this.attemptsValue >= this.options.maxAttempts) {
      this.stateValue = 'closed';
      this.logger.warn('reconnect attempts exhausted', { attempts: this.attemptsValue });
      return;
    }
    const delayMs = backoffDelayMs(this.attemptsValue, this.policy);
    this.attemptsValue += 1;
    this.stateValue = 'waiting';
    this.logger.debug('reconnect scheduled', { delayMs, attempt: this.attemptsValue });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.stateValue === 'waiting') this.open();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
