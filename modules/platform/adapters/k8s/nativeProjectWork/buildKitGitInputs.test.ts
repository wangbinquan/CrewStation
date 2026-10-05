import { expect, test } from 'bun:test';
import type { GitLabClient } from '@crewstation/gitlab-client';
import { ProjectDeletionTargetSchema, RepositoryBindingDtoSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { buildKitGitInputs } from './buildKitGitInputs';

function fixture() {
  const serviceId = newResourceId(), commit = 'a'.repeat(40), target = ProjectDeletionTargetSchema.parse({ id: newResourceId(), serviceId, slug: 'project', name: 'Project', namespace: 'cs-project', kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'project.test', previewHost: 'preview.test', serviceHost: 'project' });
  const binding = RepositoryBindingDtoSchema.parse({ serviceId, provider: 'gitlab', remoteProjectId: '383', pathWithNamespace: 'crewstation/project', httpUrl: 'http://native/crewstation/project.git', defaultBranch: 'main', state: 'ready', createdAt: '2026-09-30T16:00:35.872Z' });
  const control = { changed: false, wrongCommit: false, tree: [{ id: 'b'.repeat(40), path: 'Dockerfile', mode: '100644', type: 'blob' }] }, calls: string[] = [];
  const scm = { getBinding: async () => binding }, native = {
    getProjectDeletionState: async () => { calls.push('birth'); return { pathWithNamespace: binding.pathWithNamespace, createdAt: binding.createdAt, revision: control.changed && calls.length > 1 ? 'changed' : 'original' }; },
    getCommit: async () => ({ id: control.wrongCommit ? 'c'.repeat(40) : commit }), getRepositoryTree: async () => control.tree,
  } as unknown as GitLabClient;
  const content = { consumers: [], callbacks: [], buildInputs: [{ serviceId, commit }, { serviceId, commit }] };
  return { target, binding, control, calls, scm, native, content };
}
test('complete original SCM commit trees are retained once and bracketed by independent remote birth reads', async () => {
  const f = fixture(), result = await buildKitGitInputs(f.scm, f.native, f.target, f.content);
  expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ commit: f.content.buildInputs[0]!.commit, tree: [{ path: 'Dockerfile', mode: '100644', blob: 'b'.repeat(40) }] });
  expect(result[0]!.repositoryIdentity).toHaveLength(64); expect(f.calls).toEqual(['birth', 'birth', 'birth', 'birth']);
  expect(await buildKitGitInputs(f.scm, f.native, f.target, { consumers: [], callbacks: [] })).toEqual([]);
});
test('wrong remote births, incomplete commits, duplicate paths and unhandled native file types block cache qualification', async () => {
  for (const mode of ['changed', 'commit', 'duplicate', 'submodule', 'short commit', 'service', 'not ready']) {
    const f = fixture();
    if (mode === 'changed') f.control.changed = true; if (mode === 'commit') f.control.wrongCommit = true;
    if (mode === 'duplicate') f.control.tree.push({ ...f.control.tree[0]! });
    if (mode === 'submodule') f.control.tree[0]!.mode = '160000';
    if (mode === 'short commit') f.content.buildInputs[0]!.commit = 'abcd123';
    if (mode === 'service') f.content.buildInputs[0]!.serviceId = newResourceId();
    if (mode === 'not ready') f.binding.state = 'failed';
    await expect(buildKitGitInputs(f.scm, f.native, f.target, f.content)).rejects.toThrow();
  }
});
