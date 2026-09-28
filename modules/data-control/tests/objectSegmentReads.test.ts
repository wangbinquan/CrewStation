import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { s3ObjectPlane } from '../adapters/http/s3Objects';
import { OBJECT_READ_SEGMENT_BYTES as blockSize } from '../adapters/http/objectReadSegments';

const config = { endpoint: 'http://garage:3900', region: 'garage', bucket: 'objects', accessKeyId: 'key', secretAccessKey: 'secret' };
const location = { backendId: Bun.randomUUIDv7(), placementRevision: 1, key: 'immutable/test' };
const signal = () => new AbortController().signal;
const bytes = Buffer.alloc(blockSize * 2 + 100, 17), expected = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };

function fixture(change?: (response: Response, request: number) => Response) {
  const ranges: string[] = [], signals: AbortSignal[] = [];
  const plane = s3ObjectPlane({ endpoint: async () => config, fetcher: async (_url, input) => {
    if (input.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(bytes.length) } });
    const range = new Headers(input.headers).get('range')!; ranges.push(range); signals.push(input.signal!);
    const [start, end] = range.slice(6).split('-').map(Number) as [number, number];
    expect(end - start + 1).toBeLessThanOrEqual(blockSize);
    const response = new Response(bytes.subarray(start, end + 1), { status: 206, headers: { 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${bytes.length}` } });
    return change?.(response, ranges.length) ?? response;
  } });
  return { plane, ranges, signals };
}

test('large immutable reads preserve whole-object digest and suffix/open/closed HTTP ranges across bounded requests', async () => {
  const f = fixture();
  expect(await f.plane.verify(location, signal())).toEqual(expected);
  expect(f.ranges).toHaveLength(3);
  for (const [range, start, end] of [[`bytes=3-${blockSize + 15}`, 3, blockSize + 15], [`bytes=${blockSize + 1}-`, blockSize + 1, bytes.length - 1], ['bytes=-101', bytes.length - 101, bytes.length - 1]] as const) {
    const result = await f.plane.get(location, { signal: signal(), expected, range });
    expect(result.size).toBe(end - start + 1); expect(result.contentRange).toBe(`bytes ${start}-${end}/${bytes.length}`);
    expect(new Uint8Array(await new Response(result.body).arrayBuffer())).toEqual(new Uint8Array(bytes.subarray(start, end + 1)));
    expect((await result.completed).size).toBe(end - start + 1);
  }
  for (const range of ['bytes=-0', `bytes=${bytes.length}-`, 'bytes=99-1', 'bytes=999999999999999999999-']) await expect(f.plane.get(location, { signal: signal(), expected, range })).rejects.toThrow('范围无效');
});

test('an idle downstream cannot schedule the whole object; cancelling aborts the bounded upstream request', async () => {
  const f = fixture(), result = await f.plane.get(location, { signal: signal(), expected });
  await Bun.sleep(20);
  expect(f.ranges.length).toBeLessThan(3);
  await result.body.cancel('reader left');
  await expect(result.completed).rejects.toBe('reader left');
  expect(f.signals.every((value) => value.aborted)).toBe(true);
  const count = f.ranges.length; await Bun.sleep(20); expect(f.ranges).toHaveLength(count);
});

test('changed total, ignored Range, truncation, overflow and later backend errors cannot complete a large read', async () => {
  for (const kind of ['total', 'ignored', 'truncated', 'overflow', 'later', 'hash'] as const) {
    const f = fixture((response, request) => {
      if (kind === 'ignored' && request === 1) return new Response(null, { status: 200 });
      if (kind === 'later' && request === 2) return new Response(null, { status: 503 });
      if (kind === 'total' && request === 1) response.headers.set('content-range', `bytes 0-${blockSize - 1}/${bytes.length + 1}`);
      if ((kind === 'truncated' || kind === 'overflow') && request === 2) return new Response(new Uint8Array(kind === 'truncated' ? 1 : blockSize + 1), { status: response.status, headers: response.headers });
      return response;
    });
    await expect(f.plane.verify(location, signal(), kind === 'hash' ? { ...expected, sha256: 'a'.repeat(64) } : expected)).rejects.toThrow();
  }
  const badHead = s3ObjectPlane({ endpoint: async () => config, fetcher: async () => new Response(null) });
  await expect(badHead.verify(location, signal())).rejects.toThrow('长度无效');
});
