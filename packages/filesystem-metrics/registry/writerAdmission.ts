import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const NativeRegistryWriterSourceSchema = z.strictObject({ version: z.literal(1), identity: hash, sourceIdentity: hash,
  complete: z.literal(true), active: z.number().int().nonnegative(), total: z.number().int().nonnegative() });
/** Called while the producer holds the actual shared PostgreSQL admission.
 * The original native journal still blocks a writer after an eraser's SQL
 * connection disappears; a transport failure or new journal never means idle. */
export function nativeRegistryWriterAdmission(options: { baseUrl: string; token: string; sourceIdentity: string; journalIdentity: string;
  fetch?: (url: URL, init: RequestInit) => Promise<Response> }) {
  const base = new URL(options.baseUrl), token = options.token, expected = { sourceIdentity: hash.parse(options.sourceIdentity), journalIdentity: hash.parse(options.journalIdentity) }, fetcher = options.fetch ?? fetch;
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || token.length < 32) throw Error('Original native registry writer admission configuration is incomplete');
  const request = (path: string, init: RequestInit) => fetcher(new URL(path, base), { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
  return { observe: async () => {
    const response = await request('/native/registry/source', { method: 'GET' });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw Error('Original registry journal is unavailable'); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 4096) throw Error('Original registry journal response exceeded its budget'); chunks.push(part.value); }
      const source = NativeRegistryWriterSourceSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
      if (source.identity !== expected.journalIdentity || source.sourceIdentity !== expected.sourceIdentity || source.active > source.total) throw Error('Original registry journal identity changed');
      return source;
    } finally { await reader.cancel(); reader.releaseLock(); }
  }, assertAvailable: async () => {
    const response = await request('/native/registry/writer-admission', { method: 'POST', body: JSON.stringify(expected) });
    await response.body?.cancel();
    if (response.status !== 204) throw Error('Original registry reclamation has not released writer admission');
  } };
}
