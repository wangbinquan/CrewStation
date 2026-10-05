import { GITLAB_NATIVE_STORAGE_KINDS } from '@crewstation/gitlab-client';
import type { GitLabNativeInventory } from '@crewstation/gitlab-client';
import { jsonHash } from '@crewstation/kernel';

/** Controlled ownership metadata; no native storage reclamation is claimed. */
export function scmNativeSourceFixture() {
  const createdAt = '2026-09-11T00:00:00.000Z', request = { projectId: '383', pathWithNamespace: 'crewstation/original', createdAt, tokenIds: ['513'] };
  const runtime = { bootId: 'cf17d90b-a97b-4b68-a589-bec0153ab3e3', namespace: 'pid:[15]', readerPid: 20, readerStartedTick: '701' };
  const project = { id: '383', pathWithNamespace: request.pathWithNamespace, createdAt, archived: false, diskPath: '@hashed/original', storage: 'default', registryEnabled: false as const };
  const inventory: GitLabNativeInventory = { version: 'gitlab-native/19.2.4/v1', project, observedAt: new Date().toISOString(), readonly: true,
    runtime, nativeRevision: '', physicalReclamationProven: false, producersClosed: false, consumersStopped: false,
    credentials: { tokens: [{ model: 'PersonalAccessToken', id: '513', name: 'original', userId: '541', createdAt, expiresAt: null, revoked: true, scopes: ['read_repository'] }],
      users: [{ model: 'User', id: '541', userType: 'project_bot', state: 'active', createdAt }],
      memberships: [{ model: 'Member', id: '701', userId: '541', type: 'ProjectMember', sourceType: 'Project', sourceId: '383', createdAt }] },
    roots: ['repository', 'lfs', 'upload', 'artifact', 'trace', 'package', 'secure-file'].map(kind => ({ kind: kind as GitLabNativeInventory['roots'][number]['kind'],
      path: '/var/opt/gitlab/' + kind, configuredPath: '/var/opt/gitlab/' + kind, identity: { device: '65025', inode: '701', birthtimeNs: '1787448382460933013', kind: 'directory' } })),
    categories: GITLAB_NATIVE_STORAGE_KINDS.map(kind => ({ kind, complete: true, objects: [] })), pipelines: [] };
  reviseScmNative(inventory);
  const instance = { id: 'a'.repeat(64), image: 'sha256:' + 'b'.repeat(64), startedAt: createdAt, epoch: jsonHash({ bootId: runtime.bootId, namespace: runtime.namespace }) };
  return { request, inventory, instance };
}
export function reviseScmNative(inventory: GitLabNativeInventory) {
  inventory.nativeRevision = jsonHash({ project: inventory.project, credentials: inventory.credentials, roots: inventory.roots, categories: inventory.categories, pipelines: inventory.pipelines });
}
