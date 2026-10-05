import { expect, test } from 'bun:test';
import { gitLabDeletionPhysicsAdapter } from '@crewstation/module-scm';
import { nativeScmFixture } from './nativeScmFixture';

test('formal root SDK clients carry the frozen native scope through host guards and independently re-prove complete erasure', async () => {
  const f = nativeScmFixture(), physics = gitLabDeletionPhysicsAdapter(f.source.sources);
  const plan = { projectId: f.context.target.id, serviceIds: [], credentialIds: [],
    repositories: [{ remoteProjectId: f.native.project.id, pathWithNamespace: f.native.project.pathWithNamespace, createdAt: f.native.project.createdAt }],
    credentials: [{ remoteProjectId: f.native.project.id, remoteTokenId: '513', createdAt: f.native.project.createdAt, userId: '541' }] };
  const scope = (await physics.capture(plan)).scope!; expect(scope.retained).toHaveLength(1);
  // The formal owner records this exact retained identity in its confirmation.
  f.context.confirmed.resources[0]!.identity = scope.retained![0]!.identity;
  const stop = await f.source.run(f.context, scope.retained, () => physics.stop(f.context, scope));
  expect(stop).toMatchObject({ kind: 'done', nativeRemaining: 0, storageRemaining: 3 });
  const context = { ...f.context, phase: 'purge' as const };
  expect(await f.source.run(context, scope.retained, () => physics.purge(context, scope))).toMatchObject({ kind: 'done', nativeRemaining: 0, storageRemaining: 0 });
  expect(f.calls.filter(row => row.endsWith('-effect'))).toEqual(['fence-effect', 'destroy-effect', 'purge-effect', 'remove-effect']);
  expect(f.envelopes).toHaveLength(4); expect((await physics.prove(scope)).kind).toBe('done');
});
test('empty but completely sourced SCM history performs no native mutation and still requires the actual durable grant', async () => {
  const f = nativeScmFixture(), physics = gitLabDeletionPhysicsAdapter(f.source.sources);
  const scope = (await physics.capture({ projectId: f.context.target.id, serviceIds: [], credentialIds: [], repositories: [], credentials: [] })).scope!;
  f.context.confirmed.resources = [];
  expect(await f.source.run(f.context, scope.retained, () => physics.stop(f.context, scope))).toMatchObject({ kind: 'done', nativeRemaining: 0, storageRemaining: 0 });
  expect(f.envelopes).toHaveLength(0); f.state.denied = true;
  await expect(f.source.run(f.context, scope.retained, () => physics.stop(f.context, scope))).rejects.toThrow('expired lease');
});
