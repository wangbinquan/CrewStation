import { request } from 'node:http';
import type { SessionDeletionRequest } from '../../adapters/http/deletionTransport';

/** Real loopback HTTP independent of console tests that replace global fetch. No fake transport or RPC acknowledgements. */
export const loopbackRequest: SessionDeletionRequest = async (input, init) => new Promise<Response>((resolve, reject) => {
  const url = new URL(String(input));
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') { reject(new Error('Fixture request must target its actual loopback server')); return; }
  const req = request(url, { method: init?.method, headers: Object.fromEntries(new Headers(init?.headers)) }, (response) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    response.on('error', reject);
    response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500 })));
  });
  const abort = () => req.destroy(new Error('Fixture HTTP request aborted'));
  if (init?.signal?.aborted) { abort(); return; }
  init?.signal?.addEventListener('abort', abort, { once: true });
  req.once('close', () => init?.signal?.removeEventListener('abort', abort));
  req.once('error', reject); req.end(init?.body ? String(init.body) : undefined);
});
