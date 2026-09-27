export interface EventQueue<T> extends AsyncIterable<T> {
  push(item: T): void;
  close(): void;
  fail(error: unknown): void;
  readonly closed: boolean;
}

/** 单消费者的异步队列：驱动 push 事件，监督器 `for await` 消费；close 后消费者读完余量即结束。 */
export function createEventQueue<T>(maxBytes?: number): EventQueue<T> {
  const items: Array<{ item: T; bytes: number }> = [];
  let bytes = 0;
  let closed = false;
  let failure: unknown;
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
      if (maxBytes !== undefined && bytes + size > maxBytes) { failure = new Error('Agent event buffer exceeded its limit'); closed = true; notify(); throw failure; }
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
