import { jsonHash } from '@crewstation/kernel';
import { GITLAB_NATIVE_STORAGE_KINDS } from './protocol';
import type { GitLabNativeInventory } from './protocol';

export function nativeFixture() {
  const createdAt = '2026-09-30T16:00:35.872Z', runtime = { bootId: '73fa6bd2-3c64-4d61-8ab3-fa4ff0cc372a', namespace: 'pid:[17]', readerPid: 42, readerStartedTick: '999' };
  const request = { projectId: '383', pathWithNamespace: 'group/original', createdAt, tokenIds: ['513'] };
  const project = { id: '383', pathWithNamespace: request.pathWithNamespace, createdAt, archived: false, diskPath: '@hashed/original', storage: 'default', registryEnabled: false as const };
  const base = { id: '1', createdAt }, part = { partitionId: '100' };
  const objects: Record<string, unknown[]> = {
    repository: [{ ...base, model: 'Project', id: '383', diskPath: project.diskPath, storage: 'default' }],
    wiki: [{ ...base, model: 'Project', id: '383', diskPath: project.diskPath, storage: 'default' }],
    design: [{ ...base, model: 'Project', id: '383', diskPath: project.diskPath, storage: 'default' }, { ...base, model: 'DesignManagement::Repository', diskPath: project.diskPath + '.design' }],
    snippet: [{ ...base, model: 'SnippetRepository', snippetId: '7', diskPath: '@snippets/original', storage: 'default' }, { ...base, model: 'ProjectSnippet', id: '7' }],
    lfs: [{ ...base, model: 'LfsObject', kind: 'lfs', path: '/var/opt/gitlab/lfs/01/data', projectIds: ['383', '384'], oid: 'a'.repeat(64) }],
    upload: [{ ...base, model: 'Upload', path: '/var/opt/gitlab/uploads/original/file', bytes: 17 }],
    artifact: [{ ...base, ...part, model: 'Ci::JobArtifact', kind: 'artifact', path: '/var/opt/gitlab/artifacts/original/archive', jobId: '9', fileType: 'archive' },
      { ...base, ...part, model: 'Ci::PipelineArtifact', kind: 'artifact', path: '/var/opt/gitlab/artifacts/original/pipeline', pipelineId: '10' }],
    trace: [{ ...base, ...part, model: 'Ci::Build', status: 'failed', path: '/var/opt/gitlab/builds/2026_09/383/9.log' },
      { ...base, ...part, model: 'Ci::BuildTraceChunk', buildId: '9', store: 'database', chunkIndex: 0 }],
    package: [{ ...base, model: 'Packages::PackageFile', kind: 'package', path: '/var/opt/gitlab/packages/original/archive', packageId: '10' }, { ...base, model: 'Packages::Package', id: '10' }],
    registry: [], 'secure-file': [{ ...base, model: 'Ci::SecureFile', kind: 'secure-file', path: '/var/opt/gitlab/secure/original/cipher' }],
  };
  const facts = { project, credentials: {
    tokens: [{ ...base, model: 'PersonalAccessToken', id: '513', name: 'cs-session-original', userId: '541', expiresAt: null, revoked: true, scopes: ['read_repository'] }],
    users: [{ ...base, model: 'User', id: '541', userType: 'project_bot', state: 'active' }],
    memberships: [{ ...base, model: 'Member', userId: '541', type: 'ProjectMember', sourceType: 'Project', sourceId: '383' }],
  }, roots: ['repository', 'lfs', 'upload', 'artifact', 'trace', 'package', 'secure-file'].map(kind => ({ kind, path: '/var/opt/gitlab/' + kind, configuredPath: '/var/opt/gitlab/' + kind,
    identity: { device: '65025', inode: '18446744073709551615', birthtimeNs: '1787448382460933013', kind: 'directory' } })),
  categories: GITLAB_NATIVE_STORAGE_KINDS.map(kind => ({ kind, complete: true, objects: objects[kind] })), pipelines: [{ ...base, ...part, model: 'Ci::Pipeline', id: '10', status: 'failed' }] };
  const inventory = { ...facts, version: 'gitlab-native/19.2.4/v1', observedAt: new Date().toISOString(), readonly: true, runtime,
    nativeRevision: jsonHash(facts), physicalReclamationProven: false, producersClosed: false, consumersStopped: false } as GitLabNativeInventory;
  const instance = { id: 'a'.repeat(64), image: 'sha256:' + 'b'.repeat(64), startedAt: createdAt, epoch: jsonHash({ bootId: runtime.bootId, namespace: runtime.namespace }) };
  return { request, inventory, instance };
}
export function reviseNative(inventory: GitLabNativeInventory) {
  inventory.nativeRevision = jsonHash({ project: inventory.project, credentials: inventory.credentials, roots: inventory.roots, categories: inventory.categories, pipelines: inventory.pipelines });
}
