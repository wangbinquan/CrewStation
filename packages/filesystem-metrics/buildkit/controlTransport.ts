import { connect } from 'node:http2';
import type { ClientHttp2Session, IncomingHttpHeaders } from 'node:http2';

export type BuildKitControlMethod = 'Info' | 'ListWorkers' | 'DiskUsage' | 'ListenBuildHistory' | 'Prune' | 'UpdateBuildHistory';
export type BuildKitControlTransport = (method: BuildKitControlMethod, body: Uint8Array, signal?: AbortSignal) => Promise<readonly Uint8Array[]>;
const methods = new Set<BuildKitControlMethod>(['Info', 'ListWorkers', 'DiskUsage', 'ListenBuildHistory', 'Prune', 'UpdateBuildHistory']);
function frame(raw: Uint8Array) {
  if (raw.length > 8_388_608) throw Error('Native BuildKit request exceeds its transport budget');
  const header = Buffer.alloc(5); header.writeUInt32BE(raw.length, 1); return Buffer.concat([header, raw]);
}
export function buildKitGrpcMessages(raw: Uint8Array) {
  const bytes = Buffer.from(raw), messages: Uint8Array[] = []; let offset = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 5 || bytes[offset] !== 0) throw Error('Native BuildKit stream is truncated or compressed');
    const size = bytes.readUInt32BE(offset + 1); offset += 5;
    if (size > 8_388_608 || offset + size > bytes.length) throw Error('Native BuildKit frame is oversized or truncated');
    messages.push(bytes.subarray(offset, offset + size)); offset += size;
    if (messages.length > 100_000) throw Error('Native BuildKit message count exceeds its budget');
  }
  return messages;
}
function readStream(session: ClientHttp2Session, method: BuildKitControlMethod, body: Uint8Array, signal: AbortSignal) {
  return new Promise<readonly Uint8Array[]>((resolve, reject) => {
    let settled = false, size = 0, headers: IncomingHttpHeaders | undefined, trailers: IncomingHttpHeaders | undefined;
    const stream = session.request({ ':method': 'POST', ':path': '/moby.buildkit.v1.Control/' + method,
      'content-type': 'application/grpc', te: 'trailers', 'grpc-accept-encoding': 'identity' });
    const chunks: Buffer[] = [], abort = () => finish(Error('Original native BuildKit request was interrupted'));
    const finish = (error?: Error) => {
      if (settled) return; settled = true; signal.removeEventListener('abort', abort);
      if (error) { stream.destroy(); session.destroy(); reject(error); return; }
      try {
        if (!headers || (headers[':status'] as unknown) !== 200 || !String(headers['content-type'] ?? '').startsWith('application/grpc')
          || trailers?.['grpc-status'] !== '0' || headers['grpc-status'] !== undefined && headers['grpc-status'] !== '0') throw Error('Original native BuildKit did not provide successful gRPC EOF');
        resolve(buildKitGrpcMessages(Buffer.concat(chunks)));
      } catch (failure) { reject(failure); }
      finally { session.close(); }
    };
    signal.addEventListener('abort', abort, { once: true });
    session.once('error', () => finish(Error('Original native BuildKit connection failed')));
    if (signal.aborted) { abort(); return; }
    stream.on('response', value => { headers = value; }); stream.on('trailers', value => { trailers = value; });
    stream.on('data', (value: Buffer) => { size += value.length; if (size > 67_108_864) finish(Error('Native BuildKit response exceeds its transport budget')); else chunks.push(Buffer.from(value)); });
    stream.once('error', () => finish(Error('Original native BuildKit stream failed'))); stream.once('end', () => finish());
    stream.once('close', () => { if (!settled) finish(Error('Original native BuildKit stream closed before EOF')); });
    stream.end(frame(body));
  });
}
/** Private HTTP/2 connection. Mutating calls are only invoked by an adapter
 * that independently holds the original native producer/consumer authority. */
export function createBuildKitControlTransport(input: { baseUrl: string; timeoutMs?: number }): BuildKitControlTransport {
  const url = new URL(input.baseUrl), timeout = input.timeoutMs ?? 90_000;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 90_000) throw Error('Native BuildKit transport configuration is invalid');
  return async (method, body, callerSignal) => {
    if (!methods.has(method)) throw Error('Unsupported native BuildKit control method');
    const payload = frame(body).subarray(5), signal = AbortSignal.any([...(callerSignal ? [callerSignal] : []), AbortSignal.timeout(timeout)]);
    signal.throwIfAborted();
    return readStream(connect(url.origin), method, payload, signal);
  };
}
