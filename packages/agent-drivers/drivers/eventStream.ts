// 单消费者异步队列：驱动 push 事件，宿主的 agentSupervisor `for await` 消费。
// 与 `runtimes/task/src/agents/eventQueue.ts` 同形，但技术包不能依赖运行时，所以这里各留一份。

export interface EventStream<T> extends AsyncIterable<T> {
  push(item: T): void;
  close(): void;
  readonly closed: boolean;
}

export function createEventStream<T>(): EventStream<T> {
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
