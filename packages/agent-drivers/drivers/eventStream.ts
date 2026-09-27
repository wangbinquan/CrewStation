// 单消费者异步队列：驱动 push 事件，宿主的 agentSupervisor `for await` 消费。
// 与 `runtimes/task/src/agents/eventQueue.ts` 同形，但技术包不能依赖运行时，所以这里各留一份。

export interface EventStream<T> extends AsyncIterable<T> {
  push(item: T): void;
  close(): void;
  fail(error: unknown): void;
  readonly closed: boolean;
}

export function createEventStream<T>(maxBytes?: number): EventStream<T> {
  const items: Array<{ item: T; bytes: number }> = [];
  let bytes = 0, failure: unknown;
  let closed = false;
  let wake: (() => void) | undefined;
  const notify = (): void => {
    const resolve = wake;
    wake = undefined;
    resolve?.();
  };
  return {
    push(item) {
      if (closed) return;
      const size = maxBytes === undefined ? 0 : Buffer.byteLength(JSON.stringify(item));
      if (maxBytes !== undefined && bytes + size > maxBytes) {
        failure = new Error('Agent event buffer exceeded its limit'); closed = true; notify(); throw failure;
      }
      bytes += size; items.push({ item, bytes: size });
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    fail(error) { failure = error; closed = true; notify(); },
    get closed() {
      return closed;
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (items.length > 0) {
          const next = items.shift()!; bytes -= next.bytes; yield next.item;
          continue;
        }
        if (closed) { if (failure !== undefined) throw failure; return; }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
