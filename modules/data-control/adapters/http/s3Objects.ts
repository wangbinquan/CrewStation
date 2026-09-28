import { OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';
import { notFound, PlatformError, precondition, validation } from '@crewstation/kernel';
import type { ObjectBytePlane, ObjectEndpointConfig, ObjectLocation, ObjectTransferMeasurement, ObjectTransferMeter } from '../../ports/objectPlane';
import { objectEndpointUrl, signObjectRequest } from './s3Signing';
import { measuredObjectStream } from './objectStream';
import { objectReadResponse } from './objectReadSegments';

type Fetcher = (url: URL, init: RequestInit) => Promise<Response>;
export interface S3ObjectOptions {
  readonly endpoint: (location: ObjectLocation) => Promise<ObjectEndpointConfig>;
  readonly fetcher?: Fetcher; readonly meter?: ObjectTransferMeter;
  readonly idleMs?: number; readonly firstByteMs?: number; readonly timeoutMs?: number;
}
/** Exactly one PUT per call. Higher-level persistent attempts allocate a fresh key for every retry. */
export function s3ObjectPlane(options: S3ObjectOptions): ObjectBytePlane {
  const fetcher = options.fetcher ?? fetch;
  const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? OBJECT_STORAGE_LIMITS.transferSeconds * 1000)]);
  const record = (location: ObjectLocation, operation: ObjectTransferMeasurement['operation'], started: number, bytes: number, result: ObjectTransferMeasurement['result']) => {
    options.meter?.record({ backendId: location.backendId, spaceId: /^spaces\/([^/]+)\/attempts\//.exec(location.key)?.[1] ?? 'system', operation, result, bytes, durationSeconds: (performance.now() - started) / 1000 });
  };
  async function request(location: ObjectLocation, method: string, signal: AbortSignal, extra: { body?: ReadableStream<Uint8Array>; size?: number; sha256?: string; range?: string } = {}): Promise<Response> {
    const config = await options.endpoint(location), url = objectEndpointUrl(config.endpoint, config.bucket, location.key);
    const headers = signObjectRequest({ url, method, ...config, ...(extra.sha256 ? { payloadHash: extra.sha256 } : {}), headers: { ...(extra.size !== undefined ? { 'content-length': String(extra.size) } : {}), ...(extra.range ? { range: extra.range } : {}) } });
    const firstByte = new AbortController(), timer = setTimeout(() => firstByte.abort(new Error('Object response timeout')), options.firstByteMs ?? OBJECT_STORAGE_LIMITS.firstByteSeconds * 1000);
    try {
      // PUT receives its response only after upload: the total/idle deadlines govern its body instead.
      if (method === 'PUT') clearTimeout(timer);
      return await fetcher(url, { method, headers, signal: AbortSignal.any([signal, firstByte.signal]), redirect: 'error', ...(extra.body ? { body: extra.body } : {}) });
    } finally { clearTimeout(timer); }
  }
  async function check(response: Response, allowed: readonly number[]): Promise<void> {
    if (allowed.includes(response.status)) return;
    await response.body?.cancel();
    if (response.status === 404) throw notFound('对象字节');
    throw new PlatformError('unavailable', '对象后端请求失败', { code: 'object_backend_http_error', status: response.status });
  }
  const get = async (location: ObjectLocation, input: { signal: AbortSignal; range?: string; expected?: { size: number; sha256: string } }, operation: 'get' | 'verify') => {
    if (input.range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(input.range)) throw validation('仅支持一个 bytes Range');
    const started = performance.now(), signal = timeout(input.signal);
    let measured: ReturnType<typeof measuredObjectStream> | undefined;
    try {
      const response = await objectReadResponse((method, readSignal, range) => request(location, method, readSignal, range ? { range } : {}), check, { signal, ...(input.expected ? { size: input.expected.size } : {}), ...(input.range ? { range: input.range } : {}) });
      await check(response, input.range ? [206] : [200]);
      const rawSize = response.headers.get('content-length'), size = rawSize === null ? NaN : Number(rawSize), contentRange = response.headers.get('content-range');
      if (!response.body || !Number.isSafeInteger(size) || size < 0 || size > OBJECT_STORAGE_LIMITS.objectBytes || (input.range && !validContentRange(input.range, contentRange, size))) { await response.body?.cancel(); throw precondition('对象后端返回的长度或范围无效'); }
      if (input.expected && (input.range ? Number(contentRange?.split('/')[1]) !== input.expected.size : size !== input.expected.size)) { await response.body.cancel(); throw precondition('对象读回长度不符', { code: 'object_length_mismatch' }); }
      measured = measuredObjectStream(response.body, { size, ...(input.expected && !input.range ? { sha256: input.expected.sha256 } : {}), signal, idleMs: options.idleMs ?? OBJECT_STORAGE_LIMITS.idleSeconds * 1000 });
      void measured.completed.then(() => record(location, operation, started, measured!.bytes(), 'ok'), () => record(location, operation, started, measured!.bytes(), signal.aborted || measured!.cancelled() ? 'aborted' : 'error'));
      return { body: measured.stream, size, ...(contentRange ? { contentRange } : {}), completed: measured.completed };
    } catch (error) { if (!measured) record(location, operation, started, 0, signal.aborted ? 'aborted' : 'error'); throw error; }
  };
  return {
    inspectWrite: async (location, originalSignal) => {
      const started = performance.now(), signal = timeout(originalSignal);
      try {
        const response = await request(location, 'HEAD', signal);
        await check(response, [200, 404]); await response.body?.cancel();
        record(location, 'head', started, 0, 'ok'); return response.status === 200 ? 'committed' : 'unknown';
      } catch (error) { record(location, 'head', started, 0, signal.aborted ? 'aborted' : 'error'); throw error; }
    },
    put: async (location, input) => {
      if (!Number.isSafeInteger(input.size) || input.size < 0 || input.size > OBJECT_STORAGE_LIMITS.objectBytes || !/^[a-f0-9]{64}$/.test(input.sha256)) throw validation('无效的对象长度或摘要');
      const started = performance.now(), signal = timeout(input.signal);
      const measured = measuredObjectStream(input.body, { size: input.size, sha256: input.sha256, signal, idleMs: options.idleMs ?? OBJECT_STORAGE_LIMITS.idleSeconds * 1000, ...(input.onBytes ? { onBytes: input.onBytes } : {}) });
      try {
        const response = await request(location, 'PUT', signal, { ...input, body: measured.stream });
        await check(response, [200]); await response.body?.cancel();
        const result = await measured.completed;
        record(location, 'put', started, result.size, 'ok'); return result;
      } catch (error) { measured.cancel(error); record(location, 'put', started, measured.bytes(), signal.aborted ? 'aborted' : 'error'); throw error; }
    },
    get: (location, input) => get(location, input, 'get'),
    verify: async (location, signal, expected) => {
      const result = await get(location, { signal, ...(expected ? { expected } : {}) }, 'verify');
      const reader = result.body.getReader();
      try { while (!(await reader.read()).done) { /* Hash and length are measured by the bounded stream. */ } } finally { reader.releaseLock(); }
      return result.completed;
    },
    remove: async (location, originalSignal) => {
      const started = performance.now(), signal = timeout(originalSignal);
      try {
        const response = await request(location, 'DELETE', signal); await check(response, [200, 204, 404]); await response.body?.cancel();
        const head = await request(location, 'HEAD', signal); await head.body?.cancel();
        if (head.status !== 404) throw precondition('对象删除尚未确认', { code: 'object_deletion_unconfirmed' });
        record(location, 'delete', started, 0, 'ok');
      } catch (error) { record(location, 'delete', started, 0, signal.aborted ? 'aborted' : 'error'); throw error; }
    },
  };
}

function validContentRange(requested: string, received: string | null, size: number): boolean {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(received ?? '');
  if (!match) return false;
  const [start, end, total] = match.slice(1).map(Number) as [number, number, number];
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end || total > OBJECT_STORAGE_LIMITS.objectBytes || end - start + 1 !== size) return false;
  const [left, right] = requested.slice(6).split('-');
  return left ? start === Number(left) && end === (right ? Math.min(Number(right), total - 1) : total - 1)
    : Number(right) > 0 && start === Math.max(0, total - Number(right)) && end === total - 1;
}
