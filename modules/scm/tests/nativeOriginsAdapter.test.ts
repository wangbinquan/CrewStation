import { describe, expect, test } from 'bun:test';
import type { ProjectDeletionTarget } from '@crewstation/contracts';
import type { GitLabAccessToken, GitLabClient } from '@crewstation/gitlab-client';
import { createGitLabNativeClient, createGitLabNativeHandler } from '@crewstation/gitlab-client';
import { newResourceId } from '@crewstation/kernel';
import { scmNativeSourceFixture as nativeFixture, reviseScmNative as reviseNative } from './nativeSourceFixture';
import { gitLabNativeOriginsAdapter } from '../adapters/gitlab/nativeOrigins';
import { currentOriginsHistory } from './currentRepositoryOriginsFixture';
import { scmCurrentRepositoryOrigins } from '../application/currentRepositoryOrigins';

function setup() {
  const f = nativeFixture(), h = currentOriginsHistory();
  const history = { ...h.history,
    origins: [{ ...h.history.origins[0]!, remoteProjectId: '383', pathWithNamespace: f.request.pathWithNamespace }],
    bindings: [{ ...h.history.bindings[0]!, remoteProjectId: '383', pathWithNamespace: f.request.pathWithNamespace }],
    credentials: [{ ...h.history.credentials[0]!, remoteTokenId: '513' }] };
  f.inventory.credentials.tokens[0]!.name = 'cs-session-' + h.credentialId;
  f.inventory.credentials.tokens[0]!.createdAt = '2026-09-11T00:00:00.123456Z'; reviseNative(f.inventory);
  const api: GitLabAccessToken[] = f.inventory.credentials.tokens.map(row => ({ id: Number(row.id), userId: Number(row.userId), name: row.name,
    scopes: row.scopes, accessLevel: 30, active: false, revoked: row.revoked, expiresAt: row.expiresAt, createdAt: new Date(row.createdAt!).toISOString() }));
  const state = { id: 383, pathWithNamespace: f.request.pathWithNamespace, createdAt: f.inventory.project.createdAt, markedForDeletionOn: null };
  const calls: string[] = [], queries: unknown[] = [], auth = 'source-private-token'.padEnd(48, '0');
  const rest: Pick<GitLabClient, 'getProjectDeletionState' | 'listProjectAccessTokens'> = {
    getProjectDeletionState: async id => { calls.push('project:' + id); return structuredClone(state); },
    listProjectAccessTokens: async id => { calls.push('tokens:' + id); return structuredClone(api); },
  };
  const handler = createGitLabNativeHandler({ token: auth, instance: f.instance, observer: { inspect: async () => ({ ...f.instance }),
    read: async query => { queries.push(query); return 'CS_GITLAB_NATIVE=' + JSON.stringify(f.inventory); } } });
  const native = createGitLabNativeClient({ baseUrl: 'http://native.test', token: auth, instance: f.instance,
    fetch: (async (url, init) => handler(new Request(String(url), init))) as typeof fetch });
  const target = { id: h.projectId } as ProjectDeletionTarget;
  return { ...f, ...h, history, api, state, calls, queries, rest, native, target, adapter: gitLabNativeOriginsAdapter(rest, native) };
}
describe('SCM current native ownership adapter', () => {
  test('actual private handler and SDK provide a current witness while old callback birth stays unknown', async () => {
    const f = setup(), original = structuredClone(f.history), raw = await f.adapter.read(f.target, f.history);
    const witness = scmCurrentRepositoryOrigins(f.projectId, f.history, raw);
    expect(witness.credentials[0]).toMatchObject({ remoteTokenId: '513', platformCredentialId: f.credentialId,
      createdAt: '2026-09-11T00:00:00.123Z', historicalCreatedAt: null, historicalUserId: null });
    expect(witness.historicalCallbacksReconstructed).toBe(false); expect(f.history).toEqual(original);
    expect(f.queries).toEqual([{ projectId: '383', pathWithNamespace: f.request.pathWithNamespace, createdAt: null, tokenIds: ['513'] }]);
    expect(f.calls).toEqual(['project:383', 'tokens:383', 'tokens:383', 'project:383']);
  });
  test('missing API tokens, extra related personal tokens, shared bots and missing birth never become a witness', async () => {
    for (const change of ['api missing', 'extra token', 'human', 'group', 'foreign', 'birth', 'project', 'path']) {
      const f = setup();
      if (change === 'api missing') f.api.length = 0;
      if (change === 'extra token') f.inventory.credentials.tokens.push({ ...f.inventory.credentials.tokens[0]!, id: '514' });
      if (change === 'human') f.inventory.credentials.users[0]!.userType = 'human';
      if (change === 'group') f.inventory.credentials.memberships[0]!.sourceType = 'Group';
      if (change === 'foreign') f.inventory.credentials.memberships[0]!.sourceId = '384';
      if (change === 'birth') f.inventory.credentials.tokens[0]!.createdAt = null;
      if (change === 'project') f.state.id = 384;
      if (change === 'path') f.state.pathWithNamespace = 'group/replacement';
      reviseNative(f.inventory); await expect(f.adapter.read(f.target, f.history)).rejects.toThrow();
    }
  });
  test('birth, source failures and changes during API-native-API comparison fail closed', async () => {
    for (const change of ['known birth', 'api birth', 'native fails', 'second API fails', 'second API differs', 'second project differs']) {
      const f = setup(), original = f.rest.listProjectAccessTokens; let page = 0;
      if (change === 'known birth') f.history.origins = [{ ...f.history.origins[0]!, createdAt: '2026-10-02T00:00:00Z' }];
      if (change === 'api birth') f.state.createdAt = '2026-10-02T00:00:00Z';
      if (change === 'native fails') f.native.observe = async () => { throw Error('source-lost'); };
      f.rest.listProjectAccessTokens = async id => { const rows = await original(id); if (++page === 2) {
        if (change === 'second API fails') throw Error('api-lost');
        if (change === 'second API differs') rows[0] = { ...rows[0]!, revoked: false };
        if (change === 'second project differs') f.state.pathWithNamespace = 'group/replacement';
      } return rows; };
      await expect(f.adapter.read(f.target, f.history)).rejects.toThrow();
    }
  });
  test('the original history is copied before an awaited API call, including token IDs', async () => {
    const f = setup(), original = f.rest.getProjectDeletionState; let count = 0;
    f.rest.getProjectDeletionState = async id => { if (++count === 1) {
      f.history.origins = [{ ...f.history.origins[0]!, remoteProjectId: '384' }]; f.history.credentials = [];
    } return original(id); };
    const raw = await f.adapter.read(f.target, f.history); expect(raw.repositories[0]!.remoteProjectId).toBe('383');
    expect(f.queries).toEqual([{ projectId: '383', pathWithNamespace: f.request.pathWithNamespace, createdAt: null, tokenIds: ['513'] }]);
  });
  test('a returned credential that lacks its final platform row is still explicitly queried', async () => {
    const f = setup();
    f.history.records = [{ id: newResourceId(), serviceId: f.serviceId, kind: 'session-credential', state: 'exited', remoteProjectId: '383',
      backendPid: 1, callbackPid: 2, callbackStartedAt: '2026-09-11T00:00:00Z', process: null, result: 'failed', exitDigest: 'a'.repeat(64),
      effects: [{ intentId: newResourceId(), kind: 'credential', stage: 'returned', remoteProjectId: '383', remoteTokenId: '514', credentialId: newResourceId() }] }];
    f.inventory.credentials.tokens.push({ ...f.inventory.credentials.tokens[0]!, id: '514', name: 'returned-original' });
    f.api.push({ ...f.api[0]!, id: 514, name: 'returned-original' }); reviseNative(f.inventory);
    expect((await f.adapter.read(f.target, f.history)).repositories[0]!.nativeTokens).toHaveLength(2);
    expect(f.queries).toEqual([{ projectId: '383', pathWithNamespace: f.request.pathWithNamespace, createdAt: null, tokenIds: ['513', '514'] }]);
  });
  test('empty and duplicate repository scopes or a replacement source are rejected', async () => {
    const f = setup();
    await expect(f.adapter.read(f.target, { ...f.history, origins: [] })).rejects.toThrow();
    await expect(f.adapter.read(f.target, { ...f.history, origins: [...f.history.origins, ...f.history.origins] })).rejects.toThrow();
    const captured = await f.native.observe(f.request);
    f.native.observe = async () => ({ ...captured, after: { ...captured.after, id: 'c'.repeat(64) } });
    await expect(f.adapter.read(f.target, f.history)).rejects.toThrow();
  });
});
