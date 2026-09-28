import { expect, test } from 'bun:test';
import { createServiceStorageClient, createBusinessExecutionClient, ApiClientError } from './index';

test('metadata, immutable plans and finalization retain stable keys and route escaping', async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const options = { fetch: async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ path: String(url), method: init!.method!, body: init?.body ? JSON.parse(String(init.body)) : null }); return Response.json({ id: 'same' });
  } };
  const client = createServiceStorageClient(options), execution = createBusinessExecutionClient(options), key = { requestKey: 'one' };
  await client.space(); await client.createUpload({ ...key, name: '报告', size: 0, sha256: 'a'.repeat(64), mediaType: 'text/plain' });
  await client.upload('u/1'); await client.commit('u/1', key); await client.list({ cursor: 'a+b', limit: 1 }); await client.get('o/1');
  const reference = { ...key, ownerType: 'application' as const, ownerId: 'material:1', revision: 1 };
  await client.pin('o/1', reference); await client.unpin('o/1', reference); await client.delete('o/1', { ...key, expectedRevision: 1 });
  await client.createPlan('t/1', key); await client.plan('p/1'); await client.planEntries('p/1', { expectedRevision: 1, offset: 0, limit: 100 });
  await client.appendPlan('p/1', { ...key, expectedRevision: 1, page: 0, entries: [{ kind: 'file', path: 'report.txt', name: 'report', required: true }] });
  await client.sealPlan('p/1', { ...key, expectedRevision: 1 }); await client.abortPlan('p/1', { ...key, expectedRevision: 1 });
  const archive = { planId: Bun.randomUUIDv7(), planRevision: 1, digest: 'b'.repeat(64) };
  const final = { ...key, expectedGeneration: 1, outcome: 'succeeded' as const, archive };
  await execution.finalize('t/1', final); await execution.finalization('t/1');
  await execution.reviseArchive('t/1', { ...key, expectedGeneration: 1, expectedRevision: 1, archive, reason: 'fix optional path', confirmDiscard: false });
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
    'GET /v3/objects/space', 'POST /v3/objects/uploads', 'GET /v3/objects/uploads/u%2F1', 'POST /v3/objects/uploads/u%2F1/commit',
    'GET /v3/objects?cursor=a%2Bb&limit=1', 'GET /v3/objects/o%2F1', 'PUT /v3/objects/o%2F1/references', 'DELETE /v3/objects/o%2F1/references', 'DELETE /v3/objects/o%2F1',
    'POST /v3/objects/tasks/t%2F1/archive-plans', 'GET /v3/objects/archive-plans/p%2F1', 'GET /v3/objects/archive-plans/p%2F1/entries?expectedRevision=1&offset=0&limit=100',
    'POST /v3/objects/archive-plans/p%2F1/pages', 'POST /v3/objects/archive-plans/p%2F1/seal', 'POST /v3/objects/archive-plans/p%2F1/abort',
    'POST /v3/business-tasks/t%2F1/finalize', 'GET /v3/business-tasks/t%2F1/finalization', 'POST /v3/business-tasks/t%2F1/finalization/archive',
  ]);
  expect(calls[15]!.body).toEqual(final); expect(calls[17]!.body).toMatchObject({ requestKey: 'one', archive });
});

test('byte upload is passed as a stream once; download exposes its stream and respects cancellation', async () => {
  const body = new Blob(['内容']).stream(), abort = new AbortController(), fence = { epoch: 1, instanceId: 'instance', leaseId: 'lease' };
  let uploads = 0, transferSignal: AbortSignal | undefined;
  const client = createServiceStorageClient({ baseUrl: 'https://service.invalid', headers: { authorization: 'Bearer identity' }, fetch: async (url, init) => {
    expect(String(url)).toEndWith('/content'); const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer identity'); expect(init?.redirect).toBe('error');
    if (init?.method === 'PUT') {
      uploads++; expect(init.body).toBe(body); expect(headers.get('content-length')).toBe('6');
      expect(JSON.parse(headers.get('x-cs-object-fence')!)).toEqual(fence); return Response.json({ state: 'verifying' }, { status: 202 });
    }
    transferSignal = init?.signal ?? undefined; expect(headers.get('range')).toBe('bytes=0-2');
    return new Response(new Blob(['abc']).stream(), { status: 206 });
  } });
  expect(await client.uploadContent('upload', { body, length: 6, fence })).toMatchObject({ state: 'verifying' });
  const response = await client.download('object', { range: 'bytes=0-2', signal: abort.signal });
  expect(response.status).toBe(206); expect(await response.text()).toBe('abc'); abort.abort(); expect(transferSignal!.aborted).toBe(true);
  await expect(client.uploadContent('upload', { body, length: -1 })).rejects.toThrow('length'); expect(uploads).toBe(1);
});

test('unknown PUT replies and quota errors remain caller-visible and are never retried', async () => {
  let calls = 0, mode = 'network';
  const client = createServiceStorageClient({ fetch: async () => { calls++; if (mode === 'network') throw new Error('response lost'); return Response.json({ error: { code: 'quota_exceeded', message: 'full' } }, { status: 429, headers: { 'retry-after': '5' } }); } });
  await expect(client.uploadContent('u', { body: new Blob().stream(), length: 0 })).rejects.toBeInstanceOf(ApiClientError); expect(calls).toBe(1);
  mode = 'quota'; await expect(client.download('o')).rejects.toMatchObject({ status: 429 }); expect(calls).toBe(2);
});
