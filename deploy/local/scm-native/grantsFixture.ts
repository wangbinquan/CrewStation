import { jsonHash, newResourceId } from '../../../packages/kernel';
import type { ProjectDeletionContext } from '../../../packages/contracts';
import { ProjectIdSchema } from '../../../packages/contracts';
import { nativeFixture, reviseNative } from '../../../packages/gitlab-client/native/fixture';
import { storageFixture } from '../../../packages/gitlab-client/native/storage/fixture';
import type { GitLabDestructionRequest, GitLabActivityRequest } from '../../../packages/gitlab-client';

export function grantsFixture() {
  const f = nativeFixture(), native = f.inventory, inventory = storageFixture().inventory;
  for (const category of native.categories) for (const row of category.objects) if (row.model === 'LfsObject') row.projectIds = ['383'];
  reviseNative(native);
  const material = { native, footprint: { version: 1 as const, nativeRevision: native.nativeRevision, inventory } };
  const context: ProjectDeletionContext = { operationId: newResourceId(), generation: 1, phase: 'stop',
    target: { id: ProjectIdSchema.parse(newResourceId()), name: 'Original', slug: 'original', namespace: 'cs-original', kind: 'DigitalWorker', state: 'active', revision: '1',
      prodHost: 'original.example', previewHost: 'preview.original.example', serviceHost: 'original.service.example' },
    confirmed: { participant: 'scm', complete: true, revision: jsonHash('confirmed'), blockers: [], references: [], resources: [
      { kind: 'gitlab-retained-source', id: native.project.id, identity: jsonHash({ nativeRevision: native.nativeRevision, storageRevision: inventory.revision,
        runtime: { bootId: native.runtime.bootId, namespace: native.runtime.namespace } }),
      sourceIdentity: jsonHash({ id: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt }), scope: 'physical', count: 0 },
    ] } };
  const state = { parent: 1, native: 0, producer: 0, consumer: false, denied: false }, calls: string[] = [];
  const destruction = { inspect: async () => f.instance, run: async (query: GitLabDestructionRequest) => {
    calls.push(query.mode);
    const facts = { project: native.project, parentRemaining: state.parent, credentialsRemaining: 0, pipelinesRemaining: 0, foreignReferences: 0,
      categories: native.categories.map((row, index) => ({ kind: row.kind, complete: true, count: index === 0 ? state.native : 0 })), nativeRemaining: state.parent + state.native };
    return 'CS_GITLAB_DESTRUCTION=' + JSON.stringify({ ...facts, version: 1, observedAt: new Date().toISOString(), requestDigest: jsonHash(query), revision: jsonHash(facts),
      runtime: native.runtime, producersClosed: false, consumersStopped: false, physicalReclamationProven: false });
  } };
  const activity = { inspect: async () => f.instance, read: async (query: GitLabActivityRequest) => {
    calls.push('activity');
    const facts = { nativeRevision: native.nativeRevision, identitiesDigest: jsonHash(query.identities), workhorseInFlight: state.producer,
      gitalyInFlight: 0, sidekiqInFlight: 0, queuedProjectJobs: 0,
      consumers: state.consumer ? [{ ...query.identities[0], pid: 7, tid: 8, startedTick: '11', kind: 'mapping' }] : [] };
    return 'CS_GITLAB_ACTIVITY=' + JSON.stringify({ ...facts, version: 1, complete: true, observedAt: new Date().toISOString(), revision: jsonHash(facts),
      runtime: native.runtime, producersClosed: false, consumersStopped: false, physicalReclamationProven: false });
  } };
  const footprint = { inspect: async () => f.instance, read: async () => { calls.push('footprint'); return 'CS_GITLAB_FOOTPRINT=' + JSON.stringify(material.footprint); } };
  const assertGrant = async (grant: ProjectDeletionContext) => { calls.push('grant:' + grant.generation); if (state.denied) throw Error('expired lease'); };
  return { ...f, native, inventory, material, context, state, calls, destruction, activity, footprint, assertGrant };
}
