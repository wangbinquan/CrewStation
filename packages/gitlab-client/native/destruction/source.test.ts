import { describe, expect, test } from 'bun:test';
import { jsonHash } from '@crewstation/kernel';
import { nativeFixture, reviseNative } from '../fixture';
import { createGitLabDestructionClient, parseGitLabDestructionOutput } from './client';
import { createGitLabDestructionHandler } from './server';
import { GitLabDestructionReceiptSchema, GitLabDestructionRequestSchema } from './protocol';
import type { GitLabDestructionReceipt, GitLabDestructionRequest } from './protocol';

const token = 'destruction-private-test-token'.padEnd(48, '0');
const output = (receipt: unknown) => 'CS_GITLAB_DESTRUCTION=' + JSON.stringify(receipt);
function setup(mode: GitLabDestructionRequest['mode'] = 'destroy') {
  const f = nativeFixture(), original = structuredClone(f.inventory);
  for (const category of original.categories) for (const row of category.objects) if (row.model === 'LfsObject') row.projectIds = ['383'];
  reviseNative(original);
  const request: GitLabDestructionRequest = { mode, original }, calls: string[] = [];
  const facts = { project: structuredClone(original.project), parentRemaining: 0, credentialsRemaining: 0, pipelinesRemaining: 0, foreignReferences: 0,
    categories: original.categories.map(row => ({ kind: row.kind, complete: true as const, count: 0 })), nativeRemaining: 0 };
  const receipt: GitLabDestructionReceipt = { ...facts, version: 1, observedAt: new Date().toISOString(), requestDigest: jsonHash(request), revision: jsonHash(facts),
    runtime: f.inventory.runtime, producersClosed: false, consumersStopped: false, physicalReclamationProven: false };
  const observer = { inspect: async () => { calls.push('inspect'); return { ...f.instance }; },
    run: async (_query: GitLabDestructionRequest) => { calls.push('run'); return output(receipt); } };
  const guards = { grant: async (_query: GitLabDestructionRequest) => { calls.push('grant'); }, stop: async (_query: GitLabDestructionRequest) => { calls.push('stop'); } };
  const handler = createGitLabDestructionHandler({ token, instance: f.instance, observer, assertGrant: query => guards.grant(query), assertStopped: query => guards.stop(query) });
  const client = createGitLabDestructionClient({ baseUrl: 'http://native.test', token, instance: f.instance,
    fetch: (async (url, init) => handler(new Request(String(url), init))) as typeof fetch });
  return { ...f, request, receipt, calls, observer, guards, handler, client };
}
function revise(value: GitLabDestructionReceipt) {
  value.nativeRemaining = value.parentRemaining + value.credentialsRemaining + value.pipelinesRemaining + value.categories.reduce((sum, row) => sum + row.count, 0);
  value.revision = jsonHash({ project: value.project, parentRemaining: value.parentRemaining, credentialsRemaining: value.credentialsRemaining,
    pipelinesRemaining: value.pipelinesRemaining, foreignReferences: value.foreignReferences, categories: value.categories, nativeRemaining: value.nativeRemaining });
}
describe('normal native deletion and detached metadata verification', () => {
  test('both guards precede mutation; independent native zero still requires separate byte/consumer proof', async () => {
    const f = setup();
    expect((await f.client.run(f.request)).receipt).toMatchObject({ nativeRemaining: 0, physicalReclamationProven: false, consumersStopped: false, producersClosed: false });
    expect(f.calls).toEqual(['inspect', 'grant', 'stop', 'run', 'inspect']);
    const read = setup('observe'); read.receipt.parentRemaining = 0; read.receipt.categories[6]!.count = 2; revise(read.receipt);
    expect((await read.client.run(read.request)).receipt.nativeRemaining).toBe(2);
    expect(read.calls).toEqual(['inspect', 'run', 'inspect']);
    const purge = setup('purge');
    expect((await purge.client.run(purge.request)).receipt.nativeRemaining).toBe(0);
    expect(purge.calls).toEqual(['inspect', 'grant', 'stop', 'run', 'inspect']);
  });
  test('shared LFS, shared bot or unknown birth cannot be sent for destruction', async () => {
    for (const mode of ['lfs', 'human', 'member', 'birth', 'actor']) {
      const f = setup(), value = structuredClone(f.request);
      if (mode === 'lfs') for (const row of value.original.categories.find(row => row.kind === 'lfs')!.objects) if (row.model === 'LfsObject') row.projectIds.push('384');
      if (mode === 'human') value.original.credentials.users[0]!.userType = 'human';
      if (mode === 'member') value.original.credentials.memberships[0]!.sourceId = '384';
      if (mode === 'birth') value.original.credentials.tokens[0]!.createdAt = null;
      if (mode === 'actor') (value as unknown as Record<string, unknown>)['actorId'] = '2';
      reviseNative(value.original);
      await expect(f.client.run(value)).rejects.toThrow(); expect(f.calls).toHaveLength(0);
    }
  });
  test('scope mutation, rejected guards or changed original instance never call the native destructor', async () => {
    for (const mode of ['grant', 'stop', 'scope', 'instance', 'epoch']) {
      const f = setup();
      if (mode === 'grant') f.guards.grant = async () => { throw Error('denied'); };
      if (mode === 'stop') f.guards.stop = async () => { throw Error('in use'); };
      if (mode === 'scope') f.guards.grant = async query => { query.mode = 'observe'; };
      if (mode === 'instance') f.observer.inspect = async () => ({ ...f.instance, id: 'c'.repeat(64) });
      if (mode === 'epoch') f.request.original.runtime.namespace = 'pid:[18]';
      await expect(f.client.run(f.request)).rejects.toThrow(); expect(f.calls).not.toContain('run');
    }
  });
  test('counter omission, dishonest totals, swapped project and physical-proof flags are rejected', () => {
    const f = setup(); expect(parseGitLabDestructionOutput(output(f.receipt), f.request)).toEqual(f.receipt);
    for (const mode of ['category', 'duplicate', 'total', 'parent', 'birth', 'digest', 'flag']) {
      const value = structuredClone(f.receipt);
      if (mode === 'category') value.categories.pop();
      if (mode === 'duplicate') value.categories[1] = structuredClone(value.categories[0]!);
      if (mode === 'parent') value.parentRemaining = 2;
      if (mode === 'birth') value.project.createdAt = '2026-10-01T00:00:00Z';
      if (mode === 'flag') (value as unknown as Record<string, unknown>)['consumersStopped'] = true;
      revise(value);
      if (mode === 'total') value.nativeRemaining += 1;
      if (mode === 'digest') value.requestDigest = 'c'.repeat(64);
      expect(() => parseGitLabDestructionOutput(output(value), f.request)).toThrow();
    }
    for (const text of ['{}', output(f.receipt) + '\nsecond result', 'x'.repeat(8_388_609)]) expect(() => parseGitLabDestructionOutput(text, f.request)).toThrow();
  });
  test('replacement after mutation, stale, damaged, unavailable and oversized replies cannot certify cleanup', async () => {
    for (const mode of ['after', 'namespace', 'stale', 'invalid', 'utf8', 'oversize', 'empty', 'offline']) {
      const f = setup(); let inspections = 0;
      if (mode === 'after') f.observer.inspect = async () => ({ ...f.instance, ...(++inspections === 2 ? { id: 'c'.repeat(64) } : {}) });
      if (mode === 'namespace') f.receipt.runtime.namespace = 'pid:[18]';
      if (mode === 'stale') f.receipt.observedAt = '2000-01-01T00:00:00Z';
      const fetcher = ['invalid', 'utf8', 'oversize', 'empty', 'offline'].includes(mode) ? (async (_input: Parameters<typeof fetch>[0]) => mode === 'offline' ? new Response(null, { status: 503 })
        : new Response(mode === 'invalid' ? '{}' : mode === 'utf8' ? new Uint8Array([0xff]) : mode === 'oversize' ? 'x'.repeat(8_388_609) : null)) as typeof fetch : undefined;
      const client = fetcher ? createGitLabDestructionClient({ baseUrl: 'http://native.test', token, instance: f.instance, fetch: fetcher }) : f.client;
      await expect(client.run(f.request)).rejects.toThrow();
    }
  });
  test('the snapshot remains frozen while the command is waiting', async () => {
    const f = setup(); let entered!: () => void, resume!: () => void;
    const begun = new Promise<void>(resolve => { entered = resolve; }), pause = new Promise<void>(resolve => { resume = resolve; });
    f.observer.run = async query => { f.calls.push(query.original.project.id); entered(); await pause; return output(f.receipt); };
    const pending = f.client.run(f.request); await begun; f.request.original.project.id = '384'; resume();
    expect((await pending).receipt.project.id).toBe('383'); expect(f.calls).toContain('383');
  });
  test('authenticated native writes serialize; malformed or aborted requests execute no mutation', async () => {
    const f = setup(), make = (body = JSON.stringify(f.request), auth = token, path = '/native/gitlab/destruction', method = 'POST', signal?: AbortSignal) =>
      new Request('http://native.test' + path, { method, headers: { authorization: 'Bearer ' + auth }, ...(method === 'GET' ? {} : { body }), ...(signal ? { signal } : {}) });
    expect((await f.handler(make('', token, '/wrong'))).status).toBe(404);
    expect((await f.handler(make('', token, undefined, 'GET'))).status).toBe(405);
    expect((await f.handler(make('', 'wrong'))).status).toBe(401);
    expect((await f.handler(make('{}'))).status).toBe(503);
    expect((await f.handler(make('x'.repeat(8_388_609)))).status).toBe(503);
    expect((await f.handler(make('', token, undefined, 'POST', AbortSignal.abort()))).status).toBe(499);
    let entered!: () => void, resume!: () => void;
    const begun = new Promise<void>(resolve => { entered = resolve; }), pause = new Promise<void>(resolve => { resume = resolve; });
    f.guards.stop = async () => { entered(); await pause; };
    const first = f.handler(make()); await begun; expect((await f.handler(make())).status).toBe(409); resume();
    expect((await first).status).toBe(200); expect(f.calls.filter(value => value === 'run')).toHaveLength(1);
  });
  test('configuration cannot omit host checks or use an untrusted URL', () => {
    const f = setup();
    for (const baseUrl of ['file:///tmp', 'http://user:password@test/', 'http://test/path', 'http://test/?query', 'http://test/#hash'])
      expect(() => createGitLabDestructionClient({ baseUrl, token, instance: f.instance })).toThrow();
    expect(() => createGitLabDestructionClient({ baseUrl: 'http://test', token: 'short', instance: f.instance })).toThrow();
    expect(() => createGitLabDestructionHandler({ token: 'short', instance: f.instance, observer: f.observer, assertGrant: async () => {}, assertStopped: async () => {} })).toThrow();
    expect(() => GitLabDestructionRequestSchema.parse({ ...f.request, mode: 'unknown' })).toThrow();
    expect(() => GitLabDestructionReceiptSchema.parse({ ...f.receipt, physicalReclamationProven: true })).toThrow();
  });
});
