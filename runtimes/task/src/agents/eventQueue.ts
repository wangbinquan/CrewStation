export interface EventQueue<T> extends AsyncIterable<T> {
  push(item: T): void;
  close(): void;
  readonly closed: boolean;
}

/** 单消费者的异步队列：驱动 push 事件，监督器 `for await` 消费；close 后消费者读完余量即结束。 */
export function createEventQueue<T>(): EventQueue<T> {
  const items: T[] = [];
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
      items.push(item);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    get closed() {
      return closed;
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (items.length > 0) {
          yield items.shift() as T;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
