import { createHash, timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';
import { z } from 'zod';
import { ProjectDeletionContextSchema } from '../../../packages/contracts';
import type { ProjectDeletionContext } from '../../../packages/contracts';
import { RegistryDeletionHistorySchema, captureRegistryHistory, reclaimRegistryInventory, registryHistoryIdentity, NodeFileConsumerRequestSchema, NodeFileConsumerResponseSchema } from '../../../packages/filesystem-metrics';
import type { RegistryDeletionHistory, RegistryReclamationAuthority, NodeFileConsumerRequest, NodeFileConsumerResponse } from '../../../packages/filesystem-metrics';
import { jsonHash } from '../../../packages/kernel';
import type { NativeRegistryJournal } from './journal';

const envelope = z.strictObject({ context: ProjectDeletionContextSchema, history: RegistryDeletionHistorySchema });
const admission = z.strictObject({ sourceIdentity: z.string().regex(/^[a-f0-9]{64}$/), journalIdentity: z.string().regex(/^[a-f0-9]{64}$/) });
/** Fixed deployment volume and independent authority. No endpoint accepts a
 * path, shell command, producer-exit boolean or actor as a destruction permit. */
export function nativeRegistryService(input: { token: string; root: string; sourceIdentity: string;
  journal: NativeRegistryJournal;
  assertGrant(context: ProjectDeletionContext, signal: AbortSignal): Promise<void>;
  assertOriginalSource(history: RegistryDeletionHistory, signal: AbortSignal): Promise<void>;
  authority(context: ProjectDeletionContext, history: RegistryDeletionHistory, signal: AbortSignal): RegistryReclamationAuthority;
  fileConsumers?(request: NodeFileConsumerRequest, signal: AbortSignal): Promise<NodeFileConsumerResponse>;
}) {
  if (input.token.length < 32 || !input.root.startsWith('/') || !/^[a-f0-9]{64}$/.test(input.sourceIdentity) || input.journal.sourceIdentity !== input.sourceIdentity) throw Error('Registry native source configuration is incomplete');
  const root = input.root, fixedIdentity = input.sourceIdentity, assertGrant = input.assertGrant, assertOriginalSource = input.assertOriginalSource, createAuthority = input.authority;
  const hash = (value: string) => createHash('sha256').update(value).digest(), credential = hash('Bearer ' + input.token);
  let busy = false;
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (!['/native/registry/reclaim', '/native/registry/source', '/native/registry/writer-admission', ...(input.fileConsumers ? ['/native/registry/file-consumers'] : [])].includes(path)) return new Response(null, { status: 404 });
    if (!timingSafeEqual(credential, hash(request.headers.get('authorization') ?? ''))) return new Response(null, { status: 401 });
    if (path === '/native/registry/source') {
      if (request.method !== 'GET') return new Response(null, { status: 405 });
      try { return Response.json(input.journal.status(), { headers: { 'cache-control': 'no-store' } }); } catch { return new Response(null, { status: 503 }); }
    }
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (path === '/native/registry/file-consumers') {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
      try {
        const result = NodeFileConsumerResponseSchema.parse(await input.fileConsumers!(NodeFileConsumerRequestSchema.parse(await body(request, signal, 65_536)), signal));
        signal.throwIfAborted();
        const reply = JSON.stringify(result); if (Buffer.byteLength(reply) > 8_388_608) throw Error('Node consumer reply budget');
        return new Response(reply, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      } catch { return new Response(null, { status: signal.aborted ? 499 : 503 }); }
    }
    if (path === '/native/registry/writer-admission') {
      try {
        const expected = admission.parse(await body(request, AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]))), actual = input.journal.status();
        if (expected.sourceIdentity !== actual.sourceIdentity || expected.journalIdentity !== actual.identity) return new Response(null, { status: 403 });
        return new Response(null, { status: actual.active || busy ? 409 : 204 });
      } catch { return new Response(null, { status: 503 }); }
    }
    if (busy) return new Response(null, { status: 409 }); busy = true;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]);
    try {
      const { context, history: raw } = envelope.parse(await body(request, signal)), history = captureRegistryHistory(raw);
      const participant = context.confirmed.participant, origin = history.origin as Record<string, unknown>;
      const sourceIdentity = participant === 'runtime-environment' ? jsonHash({ nativeSource: history.sourceIdentity, consumerId: null, consumerIdentity: null }) : history.sourceIdentity;
      const kind = participant === 'runtime-environment' ? 'runtime-native:artifact' : 'release-native:artifact';
      if (!['runtime-environment', 'release'].includes(participant) || context.phase !== 'purge' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length
        || history.projectId !== context.target.id || history.sourceIdentity !== fixedIdentity || history.query.rootId !== 'local'
        || typeof origin['providerPath'] !== 'string' || dirname(origin['providerPath']) !== root || !origin['providerPath'].endsWith('/' + history.query.directory)
        || origin['rootEpoch'] !== history.original.rootIdentity || origin['volumeEpoch'] !== history.original.volumeIdentity
        || !context.confirmed.resources.some(row => row.kind === kind && row.id === 'registry-history:' + history.projectId
          && row.identity === registryHistoryIdentity(history) && row.sourceIdentity === sourceIdentity && row.scope === 'physical')) throw Error('Registry original native materials were not confirmed by this owner');
      const authority = createAuthority(structuredClone(context), structuredClone(history), signal);
      const revalidate = async () => { signal.throwIfAborted(); await assertGrant(structuredClone(context), signal); await assertOriginalSource(structuredClone(history), signal); signal.throwIfAborted(); };
      await revalidate();
      const result = await reclaimRegistryInventory(root, { query: history.query, original: history.original }, {
          exclusive: (original, work) => authority.exclusive(original, async () => {
            const callback = input.journal.begin(context, history);
            try { return await work(); } finally { callback.finish(); }
          }),
          assertClosed: async (original, currentSignal) => { await revalidate(); await authority.assertClosed(original, currentSignal); await revalidate(); },
        }, signal);
      await revalidate();
      const response = JSON.stringify({ ...result, historyIdentity: registryHistoryIdentity(history) });
      if (Buffer.byteLength(response) > 8_388_608) throw Error('Registry acknowledgement exceeded its budget');
      return new Response(response, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    } catch { return new Response(null, { status: signal.aborted ? 499 : 403 }); }
    finally { busy = false; }
  };
}
async function body(request: Request, signal: AbortSignal, budget = 25_165_824) {
  if (!request.body || Number(request.headers.get('content-length')) > budget) throw Error('Registry native envelope is unavailable or oversized');
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try { for (;;) {
    signal.throwIfAborted(); const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
    if (size > budget) throw Error('Registry native envelope budget'); chunks.push(part.value);
  } signal.throwIfAborted(); return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
