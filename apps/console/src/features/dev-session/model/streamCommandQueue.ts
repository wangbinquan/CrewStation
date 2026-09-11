/** 命令在指定毫秒内没有回 result／error 就按超时失败，避免调用方永远挂着。 */
export const COMMAND_TIMEOUT_MS = 20_000;

/** 流命令失败：code 取自 TaskRunner 的 error 帧，或本地产生的 timeout／disconnected／closed。 */
export class StreamCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StreamCommandError';
    this.code = code;
  }
}

interface PendingCommand {
  readonly resolve: (payload: unknown) => void;
  readonly reject: (error: StreamCommandError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * 命令 id → 等待中的 Promise。
 * 帧是单向的，result／error 只带 id，所以必须由客户端记住是谁发的；断线时统一失败，调用方据此提示重试。
 */
export class StreamCommandQueue {
  private readonly pending = new Map<string, PendingCommand>();
  private counter = 0;

  nextId(): string {
    this.counter += 1;
    return `c${this.counter}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /** 登记一条待回执命令；超时后自动失败并从表中移除。 */
  register(id: string, timeoutMs: number = COMMAND_TIMEOUT_MS): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new StreamCommandError('timeout', `命令 ${id} 超时未回执`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  settle(id: string, payload: unknown): boolean {
    const entry = this.take(id);
    if (!entry) return false;
    entry.resolve(payload);
    return true;
  }

  fail(id: string, code: string, message: string): boolean {
    const entry = this.take(id);
    if (!entry) return false;
    entry.reject(new StreamCommandError(code, message));
    return true;
  }

  /** 连接断开或页面卸载：在途命令不可能再有回执，一次性失败。 */
  failAll(code: string, message: string): void {
    for (const id of [...this.pending.keys()]) this.fail(id, code, message);
  }

  private take(id: string): PendingCommand | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    return entry;
  }
}
