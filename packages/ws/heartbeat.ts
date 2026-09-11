type TimerHandle = ReturnType<typeof setTimeout>;

export interface HeartbeatOptions {
  /** 两次 ping 的间隔。 */
  intervalMs: number;
  /** 发出 ping 后等待 pong 的上限；超时即调用 `onTimeout` 并停止。 */
  timeoutMs: number;
  sendPing: () => void;
  onTimeout: () => void;
}

export interface Heartbeat {
  start(): void;
  stop(): void;
  /** 收到 pong 时调用；清除当前的超时计时。 */
  pong(): void;
  readonly running: boolean;
}

/** 主动侧心跳：定期 ping，未在 `timeoutMs` 内收到 pong 视为对端失联。一个 ping 未答复前不会重复发送。 */
export function createHeartbeat(options: HeartbeatOptions): Heartbeat {
  let interval: TimerHandle | undefined;
  let pending: TimerHandle | undefined;
  let running = false;
  const clearPending = (): void => {
    if (pending !== undefined) clearTimeout(pending);
    pending = undefined;
  };
  const stop = (): void => {
    running = false;
    if (interval !== undefined) clearInterval(interval);
    interval = undefined;
    clearPending();
  };
  const tick = (): void => {
    if (pending !== undefined) return;
    // 先布防再发送：对端若同步应答（测试或进程内回环），pong 仍能命中这次计时。
    pending = setTimeout(() => {
      stop();
      options.onTimeout();
    }, options.timeoutMs);
    options.sendPing();
  };
  return {
    start() {
      if (running) return;
      running = true;
      interval = setInterval(tick, options.intervalMs);
    },
    stop,
    pong: clearPending,
    get running() {
      return running;
    },
  };
}

export interface IdleWatchdog {
  start(): void;
  stop(): void;
  /** 每收到一帧调用一次；超过 `timeoutMs` 没有任何帧即触发 `onTimeout`。 */
  touch(): void;
}

/** 被动侧看门狗：只应答 ping 的一端用它判断对端是否已经失联（半开连接）。 */
export function createIdleWatchdog(options: { timeoutMs: number; onTimeout: () => void }): IdleWatchdog {
  let timer: TimerHandle | undefined;
  const arm = (): void => {
    timer = setTimeout(() => {
      timer = undefined;
      options.onTimeout();
    }, options.timeoutMs);
  };
  return {
    start() {
      if (timer === undefined) arm();
    },
    stop() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
    touch() {
      if (timer === undefined) return;
      clearTimeout(timer);
      arm();
    },
  };
}
