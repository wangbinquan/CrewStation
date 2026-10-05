import { timingSafeEqual } from 'node:crypto';
import { MeasurementRequestSchema } from './protocol';
import type { MeasurementResponse } from './protocol';
import { measureDirectory } from './measure';
import { AbsenceRequestSchema, directoryAbsent } from './absence';
import { SourceRequestSchema, observeFilesystemSource } from './source';
import { observeFileConsumers } from './consumers';
import { ConsumerRequestSchema, ConsumerResponseSchema } from './consumersProtocol';
import {RegistryInventoryRequestSchema} from './registry/protocol';
import {observeRegistryInventory} from './registry/inventory';
import { garageInventoryResponse } from './garage/server';
import { buildKitInventoryResponse } from './buildkit/inventory/server';

export function createFilesystemMetricsHandler(options: { token: string; roots: Record<string, string>; timeoutMs?: number; procRoot?: string }) {
  if (options.token.length < 32) throw new Error('A dedicated measurement token of at least 32 characters is required');
  const credential = Buffer.from(`Bearer ${options.token}`); let busy = false;
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === '/healthz' && request.method === 'GET') return Response.json({ ok: true });
    const supplied = Buffer.from(request.headers.get('authorization') ?? '');
    if (credential.length !== supplied.length || !timingSafeEqual(credential, supplied)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['/measure', '/absence', '/source', '/consumers','/registry/inventory','/garage/inventory','/buildkit/inventory'].includes(path) || request.method !== 'POST') return new Response(null, { status: 404 });
    if (busy) return Response.json({ error: 'A measurement is already running' }, { status: 409 });
    if (Number(request.headers.get('content-length')) > (path === '/garage/inventory' ? 24 * 1024 * 1024 : path === '/buildkit/inventory' ? 1_048_576 : path === '/consumers'||path==='/registry/inventory' ? 32_768 : 16_384)) return new Response(null, { status: 413 });
    busy = true;
    try {
      if (path === '/garage/inventory') return await garageInventoryResponse(request, options.roots, options.timeoutMs ?? 30_000);
      if (path === '/buildkit/inventory') return await buildKitInventoryResponse(request, options.roots, options.timeoutMs ?? 30_000);
      if (path === '/consumers') return await consumerResponse(request, options.procRoot ?? '/proc', options.timeoutMs ?? 10_000);
      if(path==='/registry/inventory') {
        const input=RegistryInventoryRequestSchema.parse(JSON.parse(await boundedBody(request,32_768))),root=options.roots[input.rootId];
        if(!root)throw new Error('Unknown root');
        try {
          const inventory=await observeRegistryInventory(root,input,AbortSignal.any([request.signal,AbortSignal.timeout(options.timeoutMs??30_000)])),body=JSON.stringify(inventory);
          if(Buffer.byteLength(body)>8*1024*1024)throw new Error('Complete registry inventory exceeded its response budget');
          return new Response(body,{headers:{'content-type':'application/json','cache-control':'no-store'}});
        }catch{return Response.json({error:'Registry native inventory unavailable'},{status:503});}
      }
      if (path === '/source') {
        const target = SourceRequestSchema.parse(JSON.parse(await boundedBody(request))), root = options.roots[target.rootId];
        if (!root) throw new Error('Unknown root');
        return Response.json(await observeFilesystemSource(root, target, AbortSignal.any([request.signal, AbortSignal.timeout(options.timeoutMs ?? 10_000)])));
      }
      if (path === '/absence') {
        const target = AbsenceRequestSchema.parse(JSON.parse(await boundedBody(request))), root = options.roots[target.rootId];
        if (!root) throw new Error('Unknown root');
        return Response.json({ key: target.key, absent: await directoryAbsent(root, target.directory), observedAt: new Date().toISOString() });
      }
      const body = await boundedBody(request), parsed = MeasurementRequestSchema.safeParse(JSON.parse(body));
      if (!parsed.success) return Response.json({ error: 'Invalid measurement targets' }, { status: 400 });
      const items: MeasurementResponse['items'] = [], requestSignal = AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]);
      for (const target of parsed.data.targets) {
        const start = Date.now();
        try {
          const root = options.roots[target.rootId]; if (!root) throw new Error('Unknown root');
          const allocatedBytes = await measureDirectory(root, target.relativePath, AbortSignal.any([requestSignal, AbortSignal.timeout(options.timeoutMs ?? 10_000)]));
          items.push({ key: target.key, allocatedBytes, observedAt: new Date().toISOString(), durationMs: Date.now() - start, state: 'fresh' });
        } catch (error) { items.push({ key: target.key, observedAt: new Date().toISOString(), durationMs: Date.now() - start, state: 'error', reason: errorCode(error) }); }
      }
      return Response.json({ items });
    } catch { return Response.json({ error: 'Invalid or oversized measurement request' }, { status: 400 }); }
    finally { busy = false; }
  };
}
async function consumerResponse(request: Request, procRoot: string, timeoutMs: number): Promise<Response> {
  const input = ConsumerRequestSchema.parse(JSON.parse(await boundedBody(request, 32_768)));
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    const observed = await observeFileConsumers(input.identities, procRoot, signal);
    if (input.mode === 'observe' && (input.source.bootId !== observed.bootId || input.source.namespace !== observed.namespace)) {
      return Response.json(ConsumerResponseSchema.parse({ ...observed, complete: false, blockers: [...observed.blockers, { code: 'source-changed' }] }));
    }
    return Response.json(ConsumerResponseSchema.parse(observed));
  } catch { return Response.json({ error: 'Consumer observation unavailable' }, { status: 503 }); }
}
function errorCode(error: unknown): string {
  if (error instanceof Error) {
    if ('code' in error) return String(error.code);
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'Measurement timed out or was cancelled';
    return error.message.replace(/\/[^\s]+/g, '[path]').slice(0, 200);
  }
  return 'Directory measurement failed';
}
async function boundedBody(request: Request, limit = 16_384): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) throw new Error('Request too large'); chunks.push(part.value); }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel(); reader.releaseLock(); }
}
