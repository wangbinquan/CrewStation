import { describe, expect, test } from 'bun:test';
import { jsonHash } from '@crewstation/kernel';
import { nativeFixture } from '../fixture';
import { createGitLabFenceClient, parseGitLabFenceOutput } from './client';
import { createGitLabFenceHandler } from './server';
import { GitLabFenceReceiptSchema, GitLabFenceRequestSchema } from './protocol';
import type { GitLabFenceReceipt, GitLabFenceRequest } from './protocol';

const token = 'fence-private-test-token'.padEnd(48, '0');
const output = (receipt: unknown) => 'CS_GITLAB_FENCE=' + JSON.stringify(receipt);
function setup() {
  const f = nativeFixture(), { archived: _archived, registryEnabled: _registry, ...project } = f.inventory.project;
  const request: GitLabFenceRequest = { project, credentials: structuredClone(f.inventory.credentials) }, calls: string[] = [];
  request.credentials.tokens[0]!.revoked = false;
  const credentials = structuredClone(request.credentials); credentials.tokens[0]!.revoked = true; credentials.users[0]!.state = 'blocked';
  const facts = { project, credentials, pendingDelete: true, deletionInProgress: true, cancelablePipelines: 0,
    permissions: [{ userId: '1', allowed: ['create_resource_access_tokens'] }, { userId: '541', allowed: [] }] };
  const receipt = { ...structuredClone(facts), version: 1, observedAt: new Date().toISOString(), requestDigest: jsonHash(request), revision: jsonHash(facts),
    runtime: f.inventory.runtime, producersClosed: false, consumersStopped: false, physicalReclamationProven: false } as GitLabFenceReceipt;
  const observer = { inspect: async () => { calls.push('inspect'); return { ...f.instance }; },
    fence: async (query: GitLabFenceRequest) => { calls.push('fence'); expect(query).toEqual(request); return output(receipt); } };
  const grant = { assert: async (_query: GitLabFenceRequest) => { calls.push('grant'); } };
  const handler = createGitLabFenceHandler({ token, instance: f.instance, observer, assertGrant: query => grant.assert(query) });
  const client = createGitLabFenceClient({ baseUrl: 'http://native.test', token, instance: f.instance,
    fetch: (async (url, init) => handler(new Request(String(url), init))) as typeof fetch });
  return { ...f, request, receipt, calls, observer, grant, handler, client };
}
describe('original native GitLab fencing', () => {
  test('the grant precedes mutation, all original identities survive and native acknowledgements are not cleanup proof', async () => {
    const f = setup(), result = await f.client.fence(f.request);
    expect(f.calls).toEqual(['inspect', 'grant', 'fence', 'inspect']);
    expect(result.receipt).toMatchObject({ pendingDelete: true, deletionInProgress: true, cancelablePipelines: 0,
      producersClosed: false, consumersStopped: false, physicalReclamationProven: false });
    expect(result.receipt.permissions[0]!.allowed).toEqual(['create_resource_access_tokens']);
    expect(result.receipt.credentials.tokens[0]!.revoked).toBe(true);
    expect(result.receipt.credentials.users[0]!.state).toBe('blocked');
  });
  test('shared bot membership, unknown identities or missing birth cannot enter the mutator', async () => {
    for (const mode of ['shared', 'human', 'unknown token user', 'unknown membership user', 'orphan bot', 'birth', 'extra']) {
      const f = setup(), value = structuredClone(f.request);
      if (mode === 'shared') value.credentials.memberships[0]!.sourceId = '384';
      if (mode === 'human') value.credentials.users[0]!.userType = 'human';
      if (mode === 'unknown token user') value.credentials.tokens[0]!.userId = '999';
      if (mode === 'unknown membership user') value.credentials.memberships[0]!.userId = '999';
      if (mode === 'orphan bot') value.credentials.memberships = [];
      if (mode === 'birth') value.credentials.tokens[0]!.createdAt = null;
      if (mode === 'extra') (value as unknown as Record<string, unknown>)['actorId'] = '2';
      expect(() => GitLabFenceRequestSchema.parse(value)).toThrow();
      await expect(f.client.fence(value)).rejects.toThrow(); expect(f.calls).toEqual([]);
    }
  });
  test('grant denial, changed grant scope or substituted original instance never execute mutation', async () => {
    for (const mode of ['grant', 'scope', 'instance']) {
      const f = setup();
      if (mode === 'grant') f.grant.assert = async () => { throw Error('denied'); };
      if (mode === 'scope') f.grant.assert = async query => { query.project.id = '384'; };
      if (mode === 'instance') f.observer.inspect = async () => ({ ...f.instance, id: 'c'.repeat(64) });
      await expect(f.client.fence(f.request)).rejects.toThrow(); expect(f.calls).not.toContain('fence');
    }
  });
  test('mutable status is permitted on replay but swapped token, bot, member or repository birth fails', () => {
    const f = setup(); expect(parseGitLabFenceOutput(output(f.receipt), f.request)).toEqual(f.receipt);
    for (const mode of ['project', 'token', 'bot', 'member', 'digest', 'flag', 'duplicate permission', 'duplicate ability']) {
      const value = structuredClone(f.receipt);
      if (mode === 'project') value.project.createdAt = '2026-10-01T00:00:00Z';
      if (mode === 'token') value.credentials.tokens[0]!.createdAt = '2026-10-01T00:00:00Z';
      if (mode === 'bot') value.credentials.users[0]!.id = '542';
      if (mode === 'member') value.credentials.memberships[0]!.id = '2';
      if (mode === 'flag') (value as unknown as Record<string, unknown>)['producersClosed'] = true;
      if (mode === 'duplicate permission') value.permissions.push(structuredClone(value.permissions[0]!));
      if (mode === 'duplicate ability') value.permissions[0]!.allowed.push(value.permissions[0]!.allowed[0]!);
      if (mode !== 'digest') revise(value);
      else value.revision = 'c'.repeat(64);
      expect(() => parseGitLabFenceOutput(output(value), f.request)).toThrow();
    }
  });
  test('source replacement after mutation, namespace change, stale or malformed replies never certify success', async () => {
    for (const mode of ['after', 'namespace', 'stale', 'invalid', 'utf8', 'oversize', 'empty', 'offline']) {
      const f = setup(); let inspected = 0;
      if (mode === 'after') f.observer.inspect = async () => ({ ...f.instance, ...(++inspected === 2 ? { id: 'c'.repeat(64) } : {}) });
      if (mode === 'namespace') f.receipt.runtime.namespace = 'pid:[18]';
      if (mode === 'stale') f.receipt.observedAt = '2000-01-01T00:00:00Z';
      const fetcher = ['invalid', 'utf8', 'oversize', 'empty', 'offline'].includes(mode) ? (async (_input: Parameters<typeof fetch>[0]) => mode === 'offline' ? new Response(null, { status: 503 })
        : new Response(mode === 'invalid' ? '{}' : mode === 'utf8' ? new Uint8Array([0xff]) : mode === 'oversize' ? 'x'.repeat(8_388_609) : null)) as typeof fetch : undefined;
      const client = fetcher ? createGitLabFenceClient({ baseUrl: 'http://native.test', token, instance: f.instance, fetch: fetcher }) : f.client;
      await expect(client.fence(f.request)).rejects.toThrow();
    }
  });
  test('the caller cannot alter the project scope while native execution is paused', async () => {
    const f = setup(); let entered!: () => void, resume!: () => void;
    const begun = new Promise<void>(resolve => { entered = resolve; }), pause = new Promise<void>(resolve => { resume = resolve; });
    f.observer.fence = async query => { f.calls.push(query.project.id); entered(); await pause; return output(f.receipt); };
    const pending = f.client.fence(f.request); await begun; f.request.project.id = '384'; f.request.credentials.tokens[0]!.id = '999'; resume();
    expect((await pending).receipt.project.id).toBe('383'); expect(f.calls).toContain('383');
  });
  test('authentication, path, method, busy state, aborted or invalid bodies block or serialize native writes', async () => {
    const f = setup(), make = (body = JSON.stringify(f.request), auth = token, path = '/native/gitlab/fence', method = 'POST', signal?: AbortSignal) =>
      new Request('http://native.test' + path, { method, headers: { authorization: 'Bearer ' + auth }, ...(method === 'GET' ? {} : { body }), ...(signal ? { signal } : {}) });
    expect((await f.handler(make('', token, '/wrong'))).status).toBe(404);
    expect((await f.handler(make('', token, undefined, 'GET'))).status).toBe(405);
    expect((await f.handler(make('', 'wrong'))).status).toBe(401);
    expect((await f.handler(make('{}'))).status).toBe(503);
    expect((await f.handler(make('x'.repeat(8_388_609)))).status).toBe(503);
    expect((await f.handler(make('', token, undefined, 'POST', AbortSignal.abort()))).status).toBe(499);
    let entered!: () => void, resume!: () => void;
    const begun = new Promise<void>(resolve => { entered = resolve; }), pause = new Promise<void>(resolve => { resume = resolve; });
    f.grant.assert = async () => { entered(); await pause; };
    const first = f.handler(make()); await begun;
    expect((await f.handler(make())).status).toBe(409); resume(); expect((await first).status).toBe(200);
    expect(f.calls.filter(value => value === 'fence')).toHaveLength(1);
  });
  test('bad client/host configuration and dishonest source formats are rejected', () => {
    const f = setup();
    for (const baseUrl of ['file:///tmp', 'http://user:password@test/', 'http://test/path', 'http://test/?query', 'http://test/#hash'])
      expect(() => createGitLabFenceClient({ baseUrl, token, instance: f.instance })).toThrow();
    expect(() => createGitLabFenceClient({ baseUrl: 'http://test', token: 'short', instance: f.instance })).toThrow();
    expect(() => createGitLabFenceHandler({ token: 'short', instance: f.instance, observer: f.observer, assertGrant: async () => {} })).toThrow();
    for (const text of ['{}', output(f.receipt) + '\nother output', 'x'.repeat(8_388_609)]) expect(() => parseGitLabFenceOutput(text, f.request)).toThrow();
    expect(() => GitLabFenceReceiptSchema.parse({ ...f.receipt, consumersStopped: true })).toThrow();
  });
});
function revise(value: GitLabFenceReceipt) {
  value.revision = jsonHash({ project: value.project, pendingDelete: value.pendingDelete, deletionInProgress: value.deletionInProgress,
    credentials: value.credentials, cancelablePipelines: value.cancelablePipelines, permissions: value.permissions });
}
