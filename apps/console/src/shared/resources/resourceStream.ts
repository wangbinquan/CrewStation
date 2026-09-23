// RFC-025 资源推送流（SSE）的一条连接：只管收帧与断线，不管缓存；框架无关，用例可换成假的 EventSource。
import type { ResourceStreamEvent } from '@crewstation/contracts';

/** 浏览器 EventSource 里用到的部分。 */
export interface EventSourceLike {
  readonly readyState: number;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface ResourceStreamOptions {
  /** 从哪个游标开始：服务端补发它之后的变更，过旧或过新时先给快照。 */
  readonly url: (cursor: number) => string;
  readonly open: EventSourceFactory;
  readonly onEvent: (event: ResourceStreamEvent) => void;
  /** 服务端要求重读快照（reset），或连接彻底断了（EventSource 不再自己重连）：调用方重读快照后再 start。 */
  readonly onRestart: (reason: 'reset' | 'closed') => void;
}

const TYPES = ['snapshot', 'upsert', 'remove', 'heartbeat', 'reset'] as const;
const CLOSED = 2;

/** 帧的最低限度检查：只认识的类型、带着各自的必需字段；新版本服务端多出来的字段不影响（不做严格校验，避免版本错位时整条流反复重连）。 */
function parseFrame(type: typeof TYPES[number], data: string): ResourceStreamEvent | undefined {
  try {
    const event = JSON.parse(data) as Partial<ResourceStreamEvent> & Record<string, unknown>;
    if (event.type !== type) return undefined;
    if (type === 'upsert' && (typeof event.record !== 'object' || event.record === null)) return undefined;
    if (type === 'snapshot' && !Array.isArray(event.items)) return undefined;
    if ((type === 'upsert' || type === 'remove' || type === 'snapshot') && typeof event.cursor !== 'number') return undefined;
    return event as ResourceStreamEvent;
  } catch {
    return undefined;
  }
}

/**
 * 断线时浏览器自己重连并带上 Last-Event-ID（服务端按它续传）；只有连接被判为关闭（HTTP 错误、不是事件流）
 * 或收到 reset 时才交给调用方重读快照。看不懂的帧同样按「需要重读」处理。
 */
export class ResourceStreamConnection {
  private source: EventSourceLike | undefined;

  constructor(private readonly options: ResourceStreamOptions) {}

  get active(): boolean {
    return this.source !== undefined;
  }

  start(cursor: number): void {
    this.stop();
    const source = this.options.open(this.options.url(cursor));
    this.source = source;
    for (const type of TYPES) source.addEventListener(type, (message) => this.receive(source, type, message.data));
    source.onerror = () => {
      if (this.source === source && source.readyState === CLOSED) this.restart('closed');
    };
  }

  stop(): void {
    const source = this.source;
    this.source = undefined;
    source?.close();
  }

  private receive(source: EventSourceLike, type: typeof TYPES[number], data: string): void {
    if (this.source !== source) return;
    const event = parseFrame(type, data);
    if (!event) return this.restart('closed');
    if (event.type === 'reset') return this.restart('reset');
    this.options.onEvent(event);
  }

  private restart(reason: 'reset' | 'closed'): void {
    this.stop();
    this.options.onRestart(reason);
  }
}
