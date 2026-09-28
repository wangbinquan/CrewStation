import { createHash } from 'node:crypto';
import { precondition } from '@crewstation/kernel';

export interface ObjectStreamResult { readonly size: number; readonly sha256: string }
/** Single-reader pull stream: no tee or whole-object buffer; cancellation also cancels its source. */
export function measuredObjectStream(source: ReadableStream<Uint8Array>, options: {
  size: number; sha256?: string; signal: AbortSignal; idleMs: number; onBytes?: (total: number) => void;
}) {
  const reader = source.getReader(), hash = createHash('sha256');
  const completed = Promise.withResolvers<ObjectStreamResult>();
  // A fetch can reject before it consumes this stream. Its caller still observes the original failure.
  void completed.promise.catch(() => undefined);
  let size = 0, settled = false, cancelled = false, timer: ReturnType<typeof setTimeout> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const clean = () => { if (timer) clearTimeout(timer); options.signal.removeEventListener('abort', abort); };
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true; clean(); completed.reject(error); controller.error(error); void reader.cancel(error).catch(() => undefined);
  };
  const abort = () => fail(options.signal.reason ?? new Error('Object transfer aborted'));
  const touch = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => fail(new Error('Object transfer idle timeout')), options.idleMs); };
  const finish = (value: ReadableStreamDefaultController<Uint8Array>, last?: Uint8Array) => {
    const digest = hash.digest('hex');
    if (size !== options.size || (options.sha256 && digest !== options.sha256)) throw precondition('对象长度或 SHA-256 不符', { code: 'object_digest_mismatch' });
    settled = true; clean(); completed.resolve({ size, sha256: digest });
    if (last?.byteLength) value.enqueue(last);
    value.close(); reader.releaseLock();
  };
  const stream = new ReadableStream<Uint8Array>({
    start: (value) => { controller = value; options.signal.addEventListener('abort', abort, { once: true }); if (options.signal.aborted) abort(); else touch(); },
    pull: async (value) => {
      if (settled) return;
      try {
        const item = await reader.read();
        if (settled) return;
        if (item.done) { finish(value); return; }
        size += item.value.byteLength;
        if (size > options.size) throw precondition('对象内容超出声明长度', { code: 'object_length_mismatch' });
        hash.update(item.value); options.onBytes?.(size); touch();
        // Withhold the final chunk until EOF/hash verification, so Content-Length cannot mask corruption.
        if (size === options.size) {
          let tail = await reader.read();
          while (!settled && !tail.done && !tail.value.byteLength) tail = await reader.read();
          if (settled) return;
          if (!tail.done) throw precondition('对象内容超出声明长度', { code: 'object_length_mismatch' });
          finish(value, item.value); return;
        }
        value.enqueue(item.value);
      } catch (error) { fail(error); }
    },
    cancel: async (reason) => { if (settled) return; cancelled = true; settled = true; clean(); completed.reject(reason ?? new Error('Object transfer cancelled')); await reader.cancel(reason); },
  }, { highWaterMark: 1 });
  return { stream, completed: completed.promise, bytes: () => size, cancelled: () => cancelled, cancel: fail };
}
