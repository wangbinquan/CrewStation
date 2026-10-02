import type { ProjectDeletionContext, ProjectDeletionPhase } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import { SCM_STORAGE_KINDS } from '../ports/projectDeletion';
import type { ScmDeletionPhysics, ScmDeletionPlan, ScmDeletionProof, ScmDeletionScope, ScmDeletionSourceReport } from '../ports/projectDeletion';
import { repositoryWriteFixture } from './repositoryWriteFixture';

/** Controlled source only; this fixture never claims actual GitLab/filesystem acceptance. */
export async function scmDeletionFixture() {
  const calls: { phase: string; scope: ScmDeletionScope }[] = [];
  const state = { nativeRemaining: 1, storageRemaining: 3, independent: true, producersClosed: true, consumersStopped: true,
    losePurgeResponse: false, captures: 0, report: { complete: true, blockers: [], references: [] } as ScmDeletionSourceReport,
    afterEffect: undefined as (() => void) | undefined, transformScope: (scope: ScmDeletionScope) => scope };
  const scopeOf = (plan: ScmDeletionPlan): ScmDeletionScope => state.transformScope({ version: 1, plan,
    source: { identity: jsonHash('controlled native installation'), epoch: jsonHash('controlled original volume epoch'), version: 'controlled-test-source/v1' },
    repositories: plan.repositories.map((entry) => ({ ...entry, createdAt: entry.createdAt!, identity: jsonHash(entry) })),
    objects: plan.repositories.flatMap((entry) => [
      { repositoryId: entry.remoteProjectId, kind: 'repository' as const, id: 'original-main-inode', identity: jsonHash('main files'), sourceIdentity: jsonHash('original-main-inode'), count: 2 },
      { repositoryId: entry.remoteProjectId, kind: 'wiki' as const, id: 'original-wiki-inode', identity: jsonHash('wiki files'), sourceIdentity: jsonHash('original-wiki-inode'), count: 1 },
    ]), coverage: plan.repositories.flatMap((entry) => SCM_STORAGE_KINDS.map((kind) => ({ repositoryId: entry.remoteProjectId, kind, identity: jsonHash([entry.remoteProjectId, kind]), complete: true }))),
  });
  const proof = (scope: ScmDeletionScope): ScmDeletionProof => ({ kind: 'done', digest: jsonHash({ scope, native: state.nativeRemaining, storage: state.storageRemaining }), scopeDigest: jsonHash(scope), sourceIdentity: scope.source.identity,
    independent: state.independent, producersClosed: state.producersClosed, consumersStopped: state.consumersStopped, nativeRemaining: state.nativeRemaining, storageRemaining: state.storageRemaining });
  const physics: ScmDeletionPhysics = {
    capture: async (plan) => { state.captures++; return { ...state.report, scope: scopeOf(plan) }; },
    inspect: async (scope) => { calls.push({ phase: 'inspect', scope }); return state.report; },
    stop: async (_context, scope) => { calls.push({ phase: 'stop', scope }); state.afterEffect?.(); return proof(scope); },
    purge: async (_context, scope) => { calls.push({ phase: 'purge', scope }); state.nativeRemaining = 0; state.storageRemaining = 0; state.afterEffect?.();
      if (state.losePurgeResponse) { state.losePurgeResponse = false; throw new Error('Controlled native response lost after acceptance'); } return proof(scope); },
    prove: async (scope) => { calls.push({ phase: 'prove', scope }); state.afterEffect?.(); return proof(scope); },
  };
  const f = await repositoryWriteFixture(false, physics), originalCreate = f.gitlab.gateway.createProject, originalToken = f.gitlab.gateway.createAccessToken;
  f.gitlab.gateway.createProject = async (...args) => ({ ...await originalCreate(...args), createdAt: '2026-09-11T00:00:00.000Z' });
  f.gitlab.gateway.createAccessToken = async (...args) => ({ ...await originalToken(...args), createdAt: '2026-09-11T00:01:00.000Z', userId: '501' });
  const owner = f.scm.api.deletionOwner;
  if (!owner) throw new Error('SCM formal deletion owner is missing');
  let context: ProjectDeletionContext = f.context;
  const prepare = async () => {
    await f.ensure(); await f.scm.api.issueSessionCredential(f.serviceId, 15); await f.scm.api.issueBuildCredential(f.serviceId, 15);
    await f.database.db.execute(sql`INSERT INTO scm.resource_identity_aliases VALUES('service','controlled original service alias',${f.serviceId}),('project','controlled original project alias',${f.projectId})`);
    context = { ...context, confirmed: await owner.inspect(context.target) }; return context;
  };
  const run = (phase: ProjectDeletionPhase, overrides: Partial<ProjectDeletionContext> = {}) => owner.run({ ...context, phase, ...overrides });
  return { ...f, owner, physics, state, calls, prepare, run, context: () => context };
}
export type ScmDeletionFixture = Awaited<ReturnType<typeof scmDeletionFixture>>;
