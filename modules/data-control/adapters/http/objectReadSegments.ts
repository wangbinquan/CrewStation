import { OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';
import { precondition, validation } from '@crewstation/kernel';

/** Bun 1.3's fetch can prebuffer a response. Bound each immutable read, including slow consumers. */
export const OBJECT_READ_SEGMENT_BYTES = 8 * 1024 * 1024;
type Request = (method: 'HEAD' | 'GET', signal: AbortSignal, range?: string) => Promise<Response>;
type Check = (response: Response, allowed: readonly number[]) => Promise<void>;

export async function objectReadResponse(request: Request, check: Check, input: { signal: AbortSignal; size?: number; range?: string }): Promise<Response> {
  let total = input.size;
  if (total === undefined) {
    const head = await request('HEAD', input.signal); await check(head, [200]); await head.body?.cancel();
    const length = head.headers.get('content-length'); total = length === null ? NaN : Number(length);
  }
  if (!Number.isSafeInteger(total) || total < 0 || total > OBJECT_STORAGE_LIMITS.objectBytes) throw precondition('对象后端返回的长度无效');
  if (total <= OBJECT_READ_SEGMENT_BYTES) return request('GET', input.signal, input.range);
  const [start, end] = readBounds(total, input.range), abort = new AbortController(), signal = AbortSignal.any([input.signal, abort.signal]);
  let offset = start, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, remaining = 0;
  const block = async () => {
    const last = Math.min(end, offset + OBJECT_READ_SEGMENT_BYTES - 1);
    const response = await request('GET', signal, `bytes=${offset}-${last}`);
    await check(response, [206]);
    if (!response.body || response.headers.get('content-range') !== `bytes ${offset}-${last}/${total}` || response.headers.get('content-length') !== String(last - offset + 1)) {
      await response.body?.cancel(); throw precondition('对象后端返回的分段长度或范围无效');
    }
    reader = response.body.getReader(); remaining = last - offset + 1; offset = last + 1;
  };
  // Validate the first response before sending downstream success headers.
  await block();
  const body = new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      try {
        for (;;) {
          signal.throwIfAborted();
          const next = await reader!.read();
          if (!next.done) {
            remaining -= next.value.byteLength;
            if (remaining < 0) throw precondition('对象分段内容超出声明长度');
            controller.enqueue(next.value); return;
          }
          reader!.releaseLock(); reader = undefined;
          if (remaining) throw precondition('对象分段内容被截断');
          if (offset > end) { controller.close(); return; }
          await block();
        }
      } catch (error) { abort.abort(error); await reader?.cancel(error).catch(() => undefined); controller.error(error); }
    },
    cancel: async (reason) => { abort.abort(reason); await reader?.cancel(reason).catch(() => undefined); },
  }, { highWaterMark: 1 });
  return new Response(body, { status: input.range ? 206 : 200, headers: { 'content-length': String(end - start + 1), ...(input.range ? { 'content-range': `bytes ${start}-${end}/${total}` } : {}) } });
}

function readBounds(total: number, range?: string): [number, number] {
  if (!range) return [0, total - 1];
  const [left, right] = range.slice(6).split('-');
  const start = left ? Number(left) : Math.max(0, total - Number(right)), end = left && right ? Math.min(Number(right), total - 1) : total - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start) throw validation('对象读取范围无效');
  return [start, end];
}
