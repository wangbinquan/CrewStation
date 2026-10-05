import { jsonHash } from '@crewstation/kernel';
import { nativeGitlabService } from '../../../deploy/local/scm-native/service';
import { grantsFixture } from '../../../deploy/local/scm-native/grantsFixture';
import { reviseStorage } from '../../../packages/gitlab-client/native/storage/fixture';
import type { GitLabFenceRequest, GitLabStorageRemovalRequest } from '@crewstation/gitlab-client';
import { nativeScmDeletionSources } from '../adapters/scm/nativeSources';

/** Controlled native command outputs with actual host/SDK/private permit composition. */
export function nativeScmFixture() {
  const f = grantsFixture(), token = 'controlled-native-source-private-token'.repeat(2);
  const inspect = async () => f.instance;
  const handler = nativeGitlabService({ ...f, token, roots: f.native.roots,
    native: { inspect, read: async () => 'CS_GITLAB_NATIVE=' + JSON.stringify(f.native) },
    fence: { inspect, fence: async (request: GitLabFenceRequest) => {
      f.calls.push('fence-effect'); const credentials = structuredClone(request.credentials);
      credentials.tokens.forEach(row => { row.revoked = true; }); credentials.users.forEach(row => { row.state = 'blocked'; });
      const facts = { project: request.project, credentials, pendingDelete: true, deletionInProgress: true, cancelablePipelines: 0, permissions: [] };
      return 'CS_GITLAB_FENCE=' + JSON.stringify({ ...facts, version: 1, observedAt: new Date().toISOString(), requestDigest: jsonHash(request), revision: jsonHash(facts),
        runtime: f.native.runtime, producersClosed: false, consumersStopped: false, physicalReclamationProven: false });
    } },
    destruction: { ...f.destruction, run: async request => {
      if (request.mode !== 'observe') { f.calls.push(request.mode + '-effect'); f.state.parent = 0; }
      return f.destruction.run(request);
    } },
    removal: { inspect, remove: async (request: GitLabStorageRemovalRequest) => {
      f.calls.push('remove-effect'); const original = request.original;
      f.inventory.locations.forEach(row => { row.present = false; row.entries = []; }); reviseStorage(f.inventory);
      const facts = { originalRevision: original.revision, remainingRevision: f.inventory.revision,
        removedEntries: original.locations.reduce((n, row) => n + row.entries.length, 0), roots: original.roots,
        locations: original.locations.map(({ present: _p, entries: _e, ...row }) => row) };
      return 'CS_GITLAB_REMOVAL=' + JSON.stringify({ ...facts, version: 1, revision: jsonHash(facts), observedAt: new Date().toISOString(),
        runtime: f.native.runtime, producersClosed: false, consumersStopped: false, physicalReclamationProven: false });
    } },
  });
  const envelopes: unknown[] = [];
  const fetcher = Object.assign(async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request = new Request(String(url), init), path = new URL(request.url).pathname;
    if (path === '/native/gitlab/fence' || path === '/native/gitlab/storage/remove' || path === '/native/gitlab/destruction' && JSON.parse(String(init?.body)).mode !== 'observe')
      envelopes.push(JSON.parse(String(init?.body)));
    return handler(request);
  }, { preconnect: fetch.preconnect });
  const source = nativeScmDeletionSources({ baseUrl: 'http://native/', token, instance: f.instance,
    gitlabUrl: 'http://gitlab/', gitlabToken: token, assertGrant: f.assertGrant, fetch: fetcher });
  return { ...f, source, envelopes };
}
