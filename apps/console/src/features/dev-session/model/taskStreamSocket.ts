import { parseTaskStreamFrame } from '@crewstation/api-client';
import type { TaskStreamCommandInput, TaskStreamFrame } from '@crewstation/api-client';
import type { RunnerEvent } from '@crewstation/contracts';
import { StreamCommandError, StreamCommandQueue } from './streamCommandQueue';

export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export type RunnerLifecycle = Extract<RunnerEvent, { kind: 'runnerState' }>['state'];

export interface StreamState {
  readonly status: StreamStatus;
  /** streamReady 帧给出的 TaskRunner ↔ cs-session 连接状态；与浏览器自己的连接是两回事。 */
  readonly runnerConnected: boolean;
  /** TaskRunner 自报的生命周期：draining／shutting-down 时容器即将消失，界面要提前说明。 */
  readonly runnerState?: RunnerLifecycle;
  /** 收到的最后一个事件 seq；重连时作 sinceSeq，服务端只回放大于它的事件。 */
  readonly lastSeq: number;
  /** 已尝试的重连次数，归零表示连接稳定。 */
  readonly attempt: number;
  /** 最近一次连接回放的事件数。 */
  readonly replayed: number;
  readonly error?: string;
}

export type StreamEventListener = (event: RunnerEvent, seq: number) => void;

export const INITIAL_STREAM_STATE: StreamState = { status: 'connecting', runnerConnected: false, lastSeq: 0, attempt: 0, replayed: 0 };

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;

/** 指数退避加抖动：避免 cs-session 重启后所有工作台同时回连。 */
export function backoffDelay(attempt: number): number {
  const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/**
 * 工作台到任务的唯一一条 WebSocket：命令上行、事件下行。
 * 快照式状态（getState 返回不可变对象）配合 useSyncExternalStore，React 侧不必再存一份。
 */
export class TaskStreamSocket {
  private readonly queue = new StreamCommandQueue();
  private readonly stateListeners = new Set<() => void>();
  private readonly eventListeners = new Set<StreamEventListener>();
  /** 连接就绪前攒下的命令，握手完成后按序写出。 */
  private outbox: { id: string; input: TaskStreamCommandInput }[] = [];
  private socket: WebSocket | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private state: StreamState = INITIAL_STREAM_STATE;

  /** endpoint 每次连接时按最后 seq 重新求值，因此重连自带续传。 */
  constructor(private readonly endpoint: (sinceSeq: number) => string) {}

  readonly getState = (): StreamState => this.state;

  readonly subscribeState = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  readonly subscribeEvents = (listener: StreamEventListener): (() => void) => {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  };

  /**
   * 发一条命令并等待回执。
   * 连接尚未就绪时先入队，握手完成后统一写出：页面刚打开就发的命令（列目录、预览状态、开终端）
   * 因此不必各自等连接。断开时整批失败，调用方据此提示重试，而不是静默丢弃。
   */
  readonly send = (input: TaskStreamCommandInput): Promise<unknown> => {
    if (this.stopped) return Promise.reject(new StreamCommandError('closed', '连接已关闭'));
    const id = this.queue.nextId();
    const promise = this.queue.register(id);
    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ...input, id }));
    else this.outbox.push({ id, input });
    return promise;
  };

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.outbox = [];
    this.queue.failAll('closed', '连接已关闭');
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.patch({ status: 'closed' });
  }

  private open(): void {
    const socket = new WebSocket(this.endpoint(this.state.lastSeq));
    this.socket = socket;
    socket.onopen = () => this.drain(socket);
    socket.onmessage = (message: MessageEvent<unknown>) => this.receive(message.data);
    socket.onerror = () => this.patch({ error: '连接出错' });
    socket.onclose = () => this.handleClose(socket);
  }

  private drain(socket: WebSocket): void {
    const queued = this.outbox;
    this.outbox = [];
    for (const entry of queued) socket.send(JSON.stringify({ ...entry.input, id: entry.id }));
    this.patch({ status: 'open', attempt: 0, error: undefined });
  }

  private handleClose(socket: WebSocket): void {
    if (socket !== this.socket) return;
    this.socket = undefined;
    this.outbox = [];
    this.queue.failAll('disconnected', '连接已断开，命令未送达');
    if (this.stopped) return;
    const attempt = this.state.attempt + 1;
    this.patch({ status: 'reconnecting', attempt, runnerConnected: false });
    this.retryTimer = setTimeout(() => {
      if (this.stopped) return;
      this.patch({ status: 'connecting' });
      this.open();
    }, backoffDelay(attempt));
  }

  private receive(raw: unknown): void {
    const frame = parseTaskStreamFrame(raw);
    if (!frame) return;
    this.dispatch(frame);
  }

  private dispatch(frame: TaskStreamFrame): void {
    switch (frame.type) {
      case 'event':
        // runnerState 是整条流的状态而不是某个面板的事件，顺手记进快照，各处不必各订一份。
        this.patch({
          lastSeq: Math.max(this.state.lastSeq, frame.seq),
          ...(frame.event.kind === 'runnerState' ? { runnerState: frame.event.state } : {}),
        });
        for (const listener of this.eventListeners) listener(frame.event, frame.seq);
        return;
      case 'streamReady':
        this.patch({ runnerConnected: frame.connected, replayed: frame.replayed });
        return;
      case 'result':
        this.queue.settle(frame.id, frame.payload);
        return;
      case 'error':
        // id 为 open 表示连接本身被拒（无权限、任务已释放），没有对应的在途命令。
        if (!this.queue.fail(frame.id, frame.code, frame.message)) this.patch({ error: frame.message });
    }
  }

  private patch(change: Partial<StreamState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.stateListeners) listener();
  }
}
