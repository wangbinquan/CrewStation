import { expect, test } from 'bun:test';
import { createServer } from 'node:http2';
import type { ServerHttp2Stream } from 'node:http2';
import { buildKitGrpcMessages, createBuildKitControlTransport } from './controlTransport';
import { protoFields } from './protobuf';

function frame(raw: Uint8Array) { const header = Buffer.alloc(5); header.writeUInt32BE(raw.length, 1); return Buffer.concat([header, raw]); }
async function server(effect: (stream: ServerHttp2Stream) => void) {
  const listener = createServer(); listener.on('session', session => session.on('error', () => undefined));
  listener.on('stream', stream => { stream.on('error', () => undefined); effect(stream); });
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address(); if (!address || typeof address === 'string') throw Error('Native HTTP/2 fixture is unavailable');
  return { url: 'http://127.0.0.1:' + address.port, close: () => new Promise<void>(resolve => listener.close(() => resolve())) };
}
test('actual HTTP/2 native stream requires grpc success trailers and consumes split frames to EOF', async () => {
  const requests: { path: string | undefined; body: Uint8Array }[] = [];
  const native = await server(stream => {
    const body: Buffer[] = []; stream.on('data', part => body.push(Buffer.from(part)));
    stream.on('end', () => {
      requests.push({ path: stream.sentHeaders?.[':path'] as string | undefined, body: Buffer.concat(body) });
      stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true });
      stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '0' }));
      const bytes = Buffer.concat([frame(Buffer.from([8, 1])), frame(new Uint8Array())]); stream.write(bytes.subarray(0, 3)); stream.end(bytes.subarray(3));
    });
  });
  try {
    const rpc = createBuildKitControlTransport({ baseUrl: native.url });
    const response = await rpc('ListenBuildHistory', Buffer.from([24, 1]));
    expect(response.map(row => Buffer.from(row).toString('hex'))).toEqual(['0801', '']);
    expect(buildKitGrpcMessages(requests[0]!.body).map(row => protoFields(row))).toEqual([[{ number: 3, wire: 0, value: 1n }]]);
  } finally { await native.close(); }
});
test('HTTP errors, missing or failed grpc trailers, malformed frames and connection loss cannot acknowledge native EOF', async () => {
  for (const failure of ['status', 'content-type', 'trailers', 'grpc', 'compressed', 'truncated'] as const) {
    const native = await server(stream => {
      stream.resume(); stream.on('end', () => {
        stream.respond({ ':status': failure === 'status' ? 503 : 200, 'content-type': failure === 'content-type' ? 'text/plain' : 'application/grpc' }, { waitForTrailers: failure !== 'trailers' });
        if (failure !== 'trailers') stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': failure === 'grpc' ? '7' : '0' }));
        stream.end(failure === 'compressed' ? Buffer.from([1, 0, 0, 0, 0]) : failure === 'truncated' ? Buffer.from([0, 0]) : frame(new Uint8Array()));
      });
    });
    try { await expect(createBuildKitControlTransport({ baseUrl: native.url })('Info', new Uint8Array())).rejects.toThrow(); }
    finally { await native.close(); }
  }
  const closed = await server(stream => stream.session?.destroy());
  try { await expect(createBuildKitControlTransport({ baseUrl: closed.url })('Info', new Uint8Array())).rejects.toThrow(); }
  finally { await closed.close(); }
});
test('caller abort and deadline release the actual HTTP/2 stream rather than completing an unfinished source', async () => {
  const native = await server(stream => stream.resume());
  try {
    await expect(createBuildKitControlTransport({ baseUrl: native.url, timeoutMs: 10 })('Info', new Uint8Array())).rejects.toThrow('interrupted');
    const abort = new AbortController(), rpc = createBuildKitControlTransport({ baseUrl: native.url });
    const pending = rpc('Info', new Uint8Array(), abort.signal); abort.abort(); await expect(pending).rejects.toThrow('interrupted');
    await expect(rpc('Info', new Uint8Array(), abort.signal)).rejects.toThrow();
  } finally { await native.close(); }
});
test('invalid transport configuration and truncated, compressed or oversized frames fail closed', () => {
  for (const baseUrl of ['file:///tmp/native', 'http://user:pass@localhost/', 'http://localhost/path', 'http://localhost/?x=1', 'http://localhost/#x']) expect(() => createBuildKitControlTransport({ baseUrl })).toThrow('configuration');
  for (const timeoutMs of [0, 90_001, 1.5]) expect(() => createBuildKitControlTransport({ baseUrl: 'http://localhost/', timeoutMs })).toThrow('configuration');
  for (const bytes of [[0], [1, 0, 0, 0, 0], [0, 0, 0, 0, 1], [0, 0, 128, 0, 1]]) expect(() => buildKitGrpcMessages(Buffer.from(bytes))).toThrow();
  expect(buildKitGrpcMessages(new Uint8Array())).toEqual([]);
});
