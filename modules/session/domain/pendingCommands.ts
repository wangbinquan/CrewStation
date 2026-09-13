/** 命令与结果按 id 关联；超时即拒绝，避免浏览器或业务程序无限等待。 */
export interface PendingCommand {
  readonly id: string;
  readonly type: string;
  readonly sentAt: number;
  readonly timeoutMs?: number;
  resolve(payload: unknown): void;
  reject(error: { code: string; message: string }): void;
}

export class PendingCommands {
  private readonly pending = new Map<string, PendingCommand>();

  constructor(private readonly timeoutMs: number) {}

  add(command: PendingCommand): void {
    this.pending.set(command.id, command);
  }

  settle(id: string, outcome: { ok: true; payload: unknown } | { ok: false; code: string; message: string }): boolean {
    const command = this.pending.get(id);
    if (!command) return false;
    this.pending.delete(id);
    if (outcome.ok) command.resolve(outcome.payload);
    else command.reject({ code: outcome.code, message: outcome.message });
    return true;
  }

  /** 连接断开时全部拒绝，调用方决定是否重试。 */
  failAll(reason: string): number {
    const n = this.pending.size;
    for (const command of this.pending.values()) command.reject({ code: 'runner_disconnected', message: reason });
    this.pending.clear();
    return n;
  }

  expire(now: number): number {
    let n = 0;
    for (const [id, command] of this.pending) {
      if (now - command.sentAt > (command.timeoutMs ?? this.timeoutMs)) {
        this.pending.delete(id);
        command.reject({ code: 'timeout', message: `命令 ${command.type} 超时` });
        n += 1;
      }
    }
    return n;
  }

  get size(): number {
    return this.pending.size;
  }
}
