import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { ObjectEndpointConfig, ObjectTransferMeasurement } from '../ports/objectPlane';
import { objectEndpointUrl, signObjectRequest } from '../adapters/http/s3Signing';
import { s3ObjectPlane } from '../adapters/http/s3Objects';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const stream = (value: string) => new Blob([value]).stream();
const config: ObjectEndpointConfig = { endpoint: 'http://garage:3900', region: 'garage', bucket: 'crewstation-objects', accessKeyId: 'test-key', secretAccessKey: 'test-secret' };
const location = { backendId: Bun.randomUUIDv7(), placementRevision: 1, key: `spaces/${Bun.randomUUIDv7()}/attempts/${Bun.randomUUIDv7()}` };
const signal = () => new AbortController().signal;

describe('S3 object plane', () => {
  test('signatures match the independently published AWS SigV4 GET golden vector', () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
    const headers = signObjectRequest({ url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), method: 'GET', region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', headers: { range: 'bytes=0-9' }, now: new Date('2013-05-24T00:00:00Z') });
    expect(headers.get('authorization')).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
  test('locations are encoded and cannot escape the configured trusted bucket', () => {
    expect(objectEndpointUrl(config.endpoint, config.bucket, 'dir/中文 %.txt').pathname).toBe('/crewstation-objects/dir/%E4%B8%AD%E6%96%87%20%25.txt');
    for (const key of ['../other', 'a/../b', 'a\\b', 'a//b', '\0']) expect(() => objectEndpointUrl(config.endpoint, config.bucket, key)).toThrow();
    for (const endpoint of ['http://user:password@host/', 'http://host/path', 'file:///etc', 'http://host/?token=x']) expect(() => objectEndpointUrl(endpoint, config.bucket)).toThrow();
  });
  test('bounded PUT signs the complete payload hash; a failed response is never retried', async () => {
    let requests = 0;
    const observations: ObjectTransferMeasurement[] = [];
    const plane = s3ObjectPlane({ endpoint: async () => config, meter: { record: (m) => observations.push(m) }, fetcher: async (url, init) => {
      requests++; expect(init.redirect).toBe('error'); expect(new Headers(init.headers).get('content-length')).toBe('7');
      expect(new Headers(init.headers).get('x-amz-content-sha256')).toBe(hash('payload'));
      expect(url.pathname).toBe(`/${config.bucket}/${location.key}`);
      expect(await new Response(init.body).text()).toBe('payload'); return new Response(null, { status: 503 });
    } });
    await expect(plane.put(location, { body: stream('payload'), size: 7, sha256: hash('payload'), signal: signal() })).rejects.toThrow('请求失败');
    expect(requests).toBe(1);
    expect(observations).toHaveLength(1); expect(observations[0]).toMatchObject({ operation: 'put', bytes: 7, result: 'error' });
    expect(JSON.stringify(observations)).not.toContain('payload'); expect(JSON.stringify(observations)).not.toContain('test-secret');
  });
  test('wrong size or hash fails even when a backend would return success', async () => {
    const plane = s3ObjectPlane({ endpoint: async () => config, fetcher: async (_url, init) => { await new Response(init.body).text(); return new Response(null, { status: 200 }); } });
    await expect(plane.put(location, { body: stream('payload'), size: 8, sha256: hash('payload'), signal: signal() })).rejects.toThrow('不符');
    await expect(plane.put(location, { body: stream('payload'), size: 6, sha256: hash('payload'), signal: signal() })).rejects.toThrow('声明长度');
    await expect(plane.put(location, { body: stream('payload'), size: 7, sha256: hash('other'), signal: signal() })).rejects.toThrow('不符');
    expect(await plane.put(location, { body: stream(''), size: 0, sha256: hash(''), signal: signal() })).toEqual({ size: 0, sha256: hash('') });
  });
  test('verification reads bytes, ignores ETag and meters the actual read; Range requires a partial response', async () => {
    const observations: ObjectTransferMeasurement[] = [];
    const plane = s3ObjectPlane({ endpoint: async () => config, meter: { record: (m) => observations.push(m) }, fetcher: async (_url, init) => {
      if (new Headers(init.headers).has('range')) return new Response('ay', { status: 206, headers: { 'content-length': '2', 'content-range': 'bytes 1-2/7' } });
      return new Response('payload', { headers: { 'content-length': '7', etag: 'this-is-not-a-sha' } });
    } });
    expect(await plane.verify(location, signal())).toEqual({ size: 7, sha256: hash('payload') });
    const range = await plane.get(location, { signal: signal(), range: 'bytes=1-2' });
    expect(range.contentRange).toBe('bytes 1-2/7'); expect(await new Response(range.body).text()).toBe('ay');
    await expect(plane.get(location, { signal: signal(), range: 'bytes=0-1,4-5' })).rejects.toThrow('一个');
    expect(observations.map((m) => [m.operation, m.bytes, m.result])).toEqual([['verify', 7, 'ok'], ['get', 2, 'ok']]);
  });
  test('truncated downloads and aborted readers report a failed transfer without buffering or completing', async () => {
    let cancelled = false;
    const observations: ObjectTransferMeasurement[] = [];
    const source = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array([1])), cancel: () => { cancelled = true; } });
    const plane = s3ObjectPlane({ endpoint: async () => config, meter: { record: (m) => observations.push(m) }, fetcher: async (_url, init) => new Response(init.method === 'HEAD' ? null : source, { headers: { 'content-length': '1000' } }) });
    const abort = new AbortController();
    const result = await plane.get(location, { signal: abort.signal });
    const reader = result.body.getReader(); await reader.read(); abort.abort();
    await expect(reader.read()).rejects.toThrow();
    expect(cancelled).toBe(true); expect(observations[0]?.result).toBe('aborted');
    const truncated = s3ObjectPlane({ endpoint: async () => config, fetcher: async () => new Response('short', { headers: { 'content-length': '1000' } }) });
    await expect(truncated.verify(location, signal())).rejects.toThrow('不符');
  });
  test('delete requires an absence observation and cannot treat an authentication failure as success', async () => {
    const methods: string[] = [];
    let head = 403;
    const plane = s3ObjectPlane({ endpoint: async () => config, fetcher: async (_url, init) => { methods.push(init.method!); return new Response(null, { status: init.method === 'DELETE' ? 204 : head }); } });
    await expect(plane.remove(location, signal())).rejects.toThrow('尚未确认');
    head = 404; await plane.remove(location, signal());
    expect(methods).toEqual(['DELETE', 'HEAD', 'DELETE', 'HEAD']);
  });
  test('downstream cancellation counts as aborted; inconsistent partial response is rejected before exposing bytes', async () => {
    const observations: ObjectTransferMeasurement[] = [];
    let cancelled = 0;
    const plane = s3ObjectPlane({ endpoint: async () => config, meter: { record: (m) => observations.push(m) }, fetcher: async (_url, init) => new Response(init.method === 'HEAD' ? null : new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array([1])), cancel: () => { cancelled++; } }), { headers: { 'content-length': '1000' } }) });
    const download = await plane.get(location, { signal: signal() });
    await download.body.cancel(); await Promise.resolve();
    expect(cancelled).toBe(1); expect(observations).toHaveLength(1); expect(observations[0]?.result).toBe('aborted');
    for (const contentRange of ['bytes 2-3/10', 'bytes 1-3/10', 'bytes 1-2/2', 'bytes 1-2/99999999999999999999']) {
      const bad = s3ObjectPlane({ endpoint: async () => config, fetcher: async (_url, init) => init.method === 'HEAD' ? new Response(null, { headers: { 'content-length': '10' } }) : new Response('ab', { status: 206, headers: { 'content-length': '2', 'content-range': contentRange } }) });
      await expect(bad.get(location, { signal: signal(), range: 'bytes=1-2' })).rejects.toThrow('范围无效');
    }
  });
  test('corrupt reads count as failures and cannot deliver a complete Content-Length before hash verification', async () => {
    const observations: ObjectTransferMeasurement[] = [];
    const plane = s3ObjectPlane({ endpoint: async () => config, meter: { record: (m) => observations.push(m) }, fetcher: async () => new Response('payload', { headers: { 'content-length': '7' } }) });
    const expected = { size: 7, sha256: hash('altered') };
    const download = await plane.get(location, { signal: signal(), expected });
    await expect(download.body.getReader().read()).rejects.toThrow('不符');
    await expect(download.completed).rejects.toThrow('不符');
    await expect(plane.verify(location, signal(), expected)).rejects.toThrow('不符');
    expect(observations.map((m) => [m.operation, m.result])).toEqual([['get', 'error'], ['verify', 'error']]);
  });
});
