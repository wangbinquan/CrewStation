import { expect, test } from 'bun:test';
import { nativeGitlabMutationGrants } from './grants';
import { grantsFixture } from './grantsFixture';
import { reviseStorage } from '../../../packages/gitlab-client/native/storage/fixture';

test('fixed native origins and persisted permit precede every effect; revocation during drain stops destruction', async () => {
  const f = grantsFixture(), guards = nativeGitlabMutationGrants(f);
  const { archived: _a, registryEnabled: _r, ...project } = f.native.project, query = { project, credentials: f.native.credentials };
  await guards.run({ context: f.context, materials: [f.material], request: query }, async () => {
    await guards.fence(query, AbortSignal.timeout(1000));
    const destruction = { mode: 'destroy' as const, original: f.native };
    await guards.destruction(destruction, AbortSignal.timeout(1000));
    await guards.destructionStopped(destruction, AbortSignal.timeout(1000));
    f.state.denied = true; await expect(guards.destruction(destruction, AbortSignal.timeout(1000))).rejects.toThrow('expired');
  });
  expect(f.calls).toEqual(['grant:1', 'grant:1', 'observe', 'footprint', 'activity', 'grant:1', 'grant:1']);
  await expect(guards.fence(query, AbortSignal.timeout(1000))).rejects.toThrow('current-grant');
});
test('a valid bearer cannot substitute retained project, installation, file source or deletion phase', async () => {
  for (const mode of ['missing', 'duplicate', 'project', 'source', 'epoch', 'phase', 'incomplete']) {
    const f = grantsFixture(), guards = nativeGitlabMutationGrants(f), raw = { context: f.context, materials: [f.material], request: {} };
    if (mode === 'missing') raw.materials = [];
    if (mode === 'duplicate') raw.materials.push(f.material);
    if (mode === 'project') f.context.confirmed.resources[0]!.id = '384';
    if (mode === 'source') f.context.confirmed.resources[0]!.sourceIdentity = 'f'.repeat(64);
    if (mode === 'epoch') f.material.footprint.inventory.runtime.namespace = 'pid:[18]';
    if (mode === 'phase') f.context.phase = 'metadata';
    if (mode === 'incomplete') f.context.confirmed.complete = false;
    expect(() => guards.run(raw, async () => {})).toThrow(); expect(f.calls).toHaveLength(0);
  }
  const f = grantsFixture(), guards = nativeGitlabMutationGrants(f);
  await guards.run({ context: f.context, materials: [f.material], request: {} }, async () => {
    await expect(guards.destruction({ mode: 'purge', original: f.native }, AbortSignal.timeout(1000))).rejects.toThrow();
    await expect(guards.destruction({ mode: 'destroy', original: { ...f.native, observedAt: '2020-01-01T00:00:00Z' } }, AbortSignal.timeout(1000))).rejects.toThrow();
  });
});
test('physical removal requires the whole fresh prefix, zero detached records and no in-flight work or held mmap', async () => {
  for (const mode of ['allowed', 'parent', 'record', 'writer', 'mapping', 'substituted', 'revoked']) {
    const f = grantsFixture(); f.context.phase = 'purge'; f.state.parent = 0;
    const guards = nativeGitlabMutationGrants(f), request = { original: structuredClone(f.inventory) };
    if (mode === 'parent') f.state.parent = 1;
    if (mode === 'record') f.state.native = 1;
    if (mode === 'writer') f.state.producer = 1;
    if (mode === 'mapping') f.state.consumer = true;
    if (mode === 'revoked') f.state.denied = true;
    if (mode === 'substituted') { request.original.locations[0]!.entries[0]!.inode = '999'; reviseStorage(request.original); }
    const work = guards.run({ context: f.context, materials: [f.material], request }, async () => {
      await guards.removal(request, AbortSignal.timeout(1000)); await guards.removalStopped(request, AbortSignal.timeout(1000));
    });
    if (mode === 'allowed') { await work; expect(f.calls.at(-1)).toBe('grant:1'); }
    else await expect(work).rejects.toThrow();
    expect(f.calls).not.toContain('purge');
  }
});
