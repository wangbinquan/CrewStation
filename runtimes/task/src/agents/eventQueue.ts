// Single-consumer queue. A processed write is acknowledged only when the consumer
// resumes after handling the yielded item; returning early rejects the receipt.
interface Receipt { resolve(): void; reject(error: unknown): void }
export interface EventQueue<T> extends AsyncIterable<T> {
  push(item: T): void;
  write(item: T): Promise<void>;
  writeProcessed(item: T): Promise<void>;
  close(): void;
  fail(error: unknown): void;
  readonly closed: boolean;
}

export function createEventQueue<T>(maxBytes?: number): EventQueue<T> {
  const items: Array<{ item: T; bytes: number; receipt?: Receipt }> = [];
  let bytes = 0, failure: unknown, closed = false;
  let wake: (() => void) | undefined, active: Receipt | undefined;
  const writers = new Set<() => void>();
  const space = () => { for (const resolve of writers) resolve(); writers.clear(); };
  const notify = () => { const resolve = wake; wake = undefined; resolve?.(); };
  const sizeOf = (item: T) => maxBytes === undefined ? 0 : Buffer.byteLength(JSON.stringify(item));
  const enqueue = (item: T, size: number, receipt?: Receipt) => { bytes += size; items.push({ item, bytes: size, receipt }); notify(); };
  const admit = async (item: T, processed: boolean): Promise<void> => {
    const size = sizeOf(item);
    if (maxBytes !== undefined && size > maxBytes) throw new Error('Agent event exceeds its buffer limit');
    while (!closed && maxBytes !== undefined && bytes + size > maxBytes) await new Promise<void>((resolve) => { writers.add(resolve); });
    if (closed) throw failure ?? new Error('Agent event stream closed');
    if (processed) await new Promise<void>((resolve, reject) => { enqueue(item, size, { resolve, reject }); });
    else enqueue(item, size);
  };
  const stop = () => {
    closed = true; space(); notify();
    const error = failure ?? new Error('Agent event consumer stopped before processing');
    active?.reject(error); active = undefined;
    for (const pending of items) pending.receipt?.reject(error);
    items.length = 0; bytes = 0;
  };
  async function* consume() {
    try { for (;;) {
      if (items.length > 0) {
        const next = items.shift()!; bytes -= next.bytes; space(); active = next.receipt;
        yield next.item;
        active?.resolve(); active = undefined;
        continue;
      }
      if (closed) { if (failure !== undefined) throw failure; return; }
      await new Promise<void>((resolve) => { wake = resolve; });
    } } finally { stop(); }
  }
  return {
    write: (item) => admit(item, false),
    writeProcessed: (item) => admit(item, true),
    push(item) {
      if (closed) return;
      const size = sizeOf(item);
      if (maxBytes !== undefined && bytes + size > maxBytes) {
        failure = new Error('Agent event buffer exceeded its limit'); closed = true; notify(); space(); throw failure;
      }
      enqueue(item, size);
    },
    close() { closed = true; notify(); space(); },
    fail(error) { failure = error; closed = true; notify(); space(); },
    get closed() { return closed; },
    [Symbol.asyncIterator]() {
      const iterator = consume();
      return { next: () => iterator.next(),
        return: async () => { stop(); return iterator.return(); },
        throw: async (error) => { stop(); return iterator.throw(error); } };
    },
  };
}
