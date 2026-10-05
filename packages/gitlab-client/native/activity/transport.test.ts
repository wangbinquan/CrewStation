import { describe, expect, test } from 'bun:test';
import { jsonHash } from '@crewstation/kernel';
import { nativeFixture } from '../fixture';
import { createGitLabActivityClient, createGitLabActivityHandler, parseGitLabActivityOutput } from './transport';
import type { GitLabActivityReceipt } from './protocol';

const token = 'original-private-activity-token'.repeat(2);
const testFetch = (handler: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>) => handler as typeof fetch;
function fixture() {
  const f = nativeFixture(), request = { original: f.inventory, identities: [{ device: '65025', inode: '9' }] };
  const facts = { nativeRevision: f.inventory.nativeRevision, identitiesDigest: jsonHash(request.identities), workhorseInFlight: 0,
    gitalyInFlight: 0, sidekiqInFlight: 0, queuedProjectJobs: 0,
    consumers: [{ device: '65025', inode: '9', pid: 7, tid: 8, startedTick: '11', kind: 'mapping' as const }] };
  const receipt: GitLabActivityReceipt = { ...facts, version: 1, complete: true, revision: jsonHash(facts), observedAt: new Date().toISOString(),
    runtime: structuredClone(f.inventory.runtime), physicalReclamationProven: false, producersClosed: false, consumersStopped: false };
  return { ...f, request, receipt };
}
const output = (f: ReturnType<typeof fixture>) => 'CS_GITLAB_ACTIVITY=' + JSON.stringify(f.receipt);
const serve = (f: ReturnType<typeof fixture>) => createGitLabActivityHandler({ token, instance: f.instance, observer: { inspect: async () => f.instance, read: async () => output(f) } });
const revise = (f: ReturnType<typeof fixture>) => { const { version: _v, complete: _c, observedAt: _t, runtime: _r, revision: _d,
  physicalReclamationProven: _p, producersClosed: _w, consumersStopped: _s, ...facts } = f.receipt; f.receipt.revision = jsonHash(facts); };

describe('all-thread GitLab activity source', () => {
  test('real request/response preserves busy counters and held mappings without declaring deletion', async () => {
    const f = fixture(); f.receipt.workhorseInFlight = 2; f.receipt.queuedProjectJobs = 1; revise(f);
    const handler = serve(f), client = createGitLabActivityClient({ baseUrl: 'http://private/', token, instance: f.instance, fetch: testFetch(async (input, init) => handler(new Request(input, init))) });
    expect((await client.observe(f.request)).receipt).toEqual(f.receipt);
    expect(parseGitLabActivityOutput(output(f), f.request).consumers[0]!.kind).toBe('mapping');
    expect(f.receipt.producersClosed).toBe(false); expect(f.receipt.physicalReclamationProven).toBe(false);
  });
  test('missing categories of evidence, foreign inode, changed digest and namespace cannot claim absence', () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => { f.receipt.identitiesDigest = 'e'.repeat(64); },
      (f: ReturnType<typeof fixture>) => { f.receipt.nativeRevision = 'e'.repeat(64); },
      (f: ReturnType<typeof fixture>) => { f.receipt.consumers[0]!.inode = '19'; },
      (f: ReturnType<typeof fixture>) => { f.receipt.runtime.namespace = 'pid:[18]'; },
    ]) { const f = fixture(); change(f); revise(f); expect(() => parseGitLabActivityOutput(output(f), f.request)).toThrow(); }
    const f = fixture();
    for (const reply of ['noise\n' + output(f), output(f) + '\n{}', 'x'.repeat(8_388_609), 'CS_GITLAB_ACTIVITY={}', 'CS_GITLAB_ACTIVITY=' + JSON.stringify({ ...f.receipt, producersClosed: true })])
      expect(() => parseGitLabActivityOutput(reply, f.request)).toThrow();
  });
  test('auth, endpoint, method, strict request, abort and overlapping reads fail closed', async () => {
    const f = fixture(), handler = serve(f), req = (body: string, signal?: AbortSignal) => new Request('http://private/native/gitlab/activity', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body, signal });
    expect((await handler(new Request('http://private/other'))).status).toBe(404);
    expect((await handler(new Request('http://private/native/gitlab/activity'))).status).toBe(405);
    expect((await handler(new Request('http://private/native/gitlab/activity', { method: 'POST' }))).status).toBe(401);
    expect((await handler(req(JSON.stringify({ ...f.request, consumers: [] })))).status).toBe(503);
    expect((await handler(req('x'.repeat(8_388_609)))).status).toBe(503);
    const controller = new AbortController(); controller.abort(); expect((await handler(req(JSON.stringify(f.request), controller.signal))).status).toBe(499);
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const busy = createGitLabActivityHandler({ token, instance: f.instance, observer: { inspect: async () => f.instance, read: async () => { await pending; return output(f); } } });
    const first = busy(req(JSON.stringify(f.request))); expect((await busy(req(JSON.stringify(f.request)))).status).toBe(409); release(); expect((await first).status).toBe(200);
    expect(() => createGitLabActivityHandler({ token: 'short', instance: f.instance, observer: { inspect: async () => f.instance, read: async () => '' } })).toThrow();
  });
  test('frozen client input and source reject stale, broken, oversized and replaced replies', async () => {
    const f = fixture(), snapshot = structuredClone(f.request); let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const client = createGitLabActivityClient({ baseUrl: 'http://private/', token, instance: f.instance, fetch: testFetch(async (_input, init) => {
      await ready; expect(JSON.parse(init!.body as string)).toEqual(snapshot); return Response.json({ before: f.instance, after: f.instance, receipt: f.receipt });
    }) });
    const first = client.observe(f.request); f.request.original.project.id = '999'; release(); expect((await first).receipt.consumers).toHaveLength(1);
    for (const reply of [
      (v: ReturnType<typeof fixture>) => Response.json({ before: { ...v.instance, id: 'f'.repeat(64) }, after: v.instance, receipt: v.receipt }),
      (v: ReturnType<typeof fixture>) => { v.receipt.observedAt = '2020-01-01T00:00:00Z'; return Response.json({ before: v.instance, after: v.instance, receipt: v.receipt }); },
      () => new Response(null, { status: 503 }), () => new Response(new Uint8Array([0xff])), () => new Response('x'.repeat(8_388_609)),
      () => new Response(new ReadableStream({ start(control) { control.error(Error('lost-source')); } })),
    ]) { const v = fixture(), invalid = createGitLabActivityClient({ baseUrl: 'http://private/', token, instance: v.instance, fetch: testFetch(async () => reply(v)) }); await expect(invalid.observe(v.request)).rejects.toThrow(); }
    for (const baseUrl of ['file:///tmp', 'http://user:secret@host/', 'http://host/path', 'http://host/?query'])
      expect(() => createGitLabActivityClient({ baseUrl, token, instance: fixture().instance })).toThrow();
    const v = fixture(), wrongEpoch = createGitLabActivityClient({ baseUrl: 'http://private/', token, instance: { ...v.instance, epoch: 'e'.repeat(64) } });
    await expect(wrongEpoch.observe(v.request)).rejects.toThrow();
  });
});
