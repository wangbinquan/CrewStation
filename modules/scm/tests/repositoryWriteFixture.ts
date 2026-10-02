import type { ProjectDeletionContext, ProjectId, ServiceId } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { createTestDatabase } from '@crewstation/testkit';
import { createScmModule, scmMigrations } from '../wiring';
import { TEST_SETTINGS, fakeGit, fakeGitLab, fakeScratch, fakeTemplates, mutableClock } from './fakeAdapters';

export async function repositoryWriteFixture(legacy = false) {
  const migrations = legacy ? { ...scmMigrations, files: scmMigrations.files.filter((f) => !/^000[56]_/.test(f.name)) } : scmMigrations;
  const database = await createTestDatabase([migrations]), gitlab = fakeGitLab(), git = fakeGit(gitlab), clock = mutableClock();
  const projectId = newResourceId() as ProjectId, serviceId = newResourceId() as ServiceId, operationId = newResourceId();
  const process = { podUid: newResourceId(), containerId: 'containerd://' + 'a'.repeat(64), nodeUid: newResourceId(), nodeName: 'original-node' };
  let stopped = false, grants = 0;
  const grant = async (context: ProjectDeletionContext) => {
    grants++;
    if (context.target.id !== projectId || context.operationId !== operationId) throw precondition('原项目许可不匹配');
  };
  const scm = createScmModule({ db: database.db, settings: TEST_SETTINGS, clock,
    project: { authorize: async () => 'owner' as const, isAdmin: async () => false, assertProjectAvailable: async () => undefined, assertProjectDeletionGrant: grant },
    processes: { protectCurrent: async () => process, sweep: async (accept) => { if (stopped) await accept.stopped(process, jsonHash({ process, stopped: true })); } },
    overrides: { gitlab: gitlab.gateway, git: git.runner, templates: fakeTemplates().source, scratch: fakeScratch().dirs },
  });
  const context: ProjectDeletionContext = { operationId, generation: 1, phase: 'seal',
    target: { id: projectId, serviceId, slug: 'write-proof', name: 'SCM write proof', namespace: 'cs-write-proof', kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'write-proof.test', previewHost: 'preview.write-proof.test', serviceHost: 'write-proof.svc.test' },
    confirmed: { participant: 'scm', revision: jsonHash('module grant fixture; no physical reclamation'), complete: true, resources: [], blockers: [], references: [] },
  };
  const writes = () => {
    if (!scm.api.repositoryWrites) throw new Error('Original SCM callback journal is unavailable');
    return scm.api.repositoryWrites;
  };
  const ensure = () => scm.api.ensureRepository(serviceId, projectId, { slug: 'write-proof', templateId: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
  return { database, scm, gitlab, git, clock, projectId, serviceId, process, context, writes, ensure, grants: () => grants, stopProcess: () => { stopped = true; } };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
export type RepositoryWriteFixture = Awaited<ReturnType<typeof repositoryWriteFixture>>;
