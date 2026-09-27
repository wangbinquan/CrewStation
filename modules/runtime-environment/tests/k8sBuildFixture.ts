import { RuntimeImageBuildDtoSchema, RuntimeImageRevisionDtoSchema } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { newResourceId } from '@crewstation/kernel';
import { runtimeImageBuildPlan } from '../domain/buildPlan';
import type { ImageBuild } from '../domain/records';
import type { BuildResourceRecord, RuntimeBuildIntents, RuntimeBuildLedger } from '../ports/buildLedger';
import type { RuntimeBuildCredentials } from '../ports/buildCredentials';
import { kubernetesRuntimeImageBuildExecutor } from '../adapters/k8s/buildExecutor';

export function k8sBuildFixture() {
  const now = new Date('2026-09-27T00:00:00Z'), digest = `sha256:${'a'.repeat(64)}`;
  const revision = RuntimeImageRevisionDtoSchema.parse({ id: newResourceId(), imageId: newResourceId(), revision: 1, createdBy: newResourceId(), createdAt: now.toISOString(), recipeDigest: digest, commitSha: 'b'.repeat(40), baseImage: `registry.internal:5000/crewstation/task@${digest}`, source: { kind: 'source', usage: 'task', architecture: 'linux/amd64', repositoryBindingId: newResourceId(), ref: 'main' }, initializer: { steps: [], env: {}, secrets: [] }, tools: [] });
  let build: ImageBuild = { ...RuntimeImageBuildDtoSchema.parse({ id: newResourceId(), imageId: revision.imageId, projectId: newResourceId(), revisionId: revision.id, state: 'building', stage: 'building', createdBy: revision.createdBy, createdAt: now.toISOString(), updatedAt: now.toISOString(), deadline: new Date(now.getTime() + 600000).toISOString(), attempt: 1, resourceId: newResourceId() }), epoch: 1, executionEpoch: 1, requestKey: 'one', inputDigest: digest, leaseOwner: 'test', leaseUntil: new Date(now.getTime() + 60000).toISOString() };
  const resources = { cpu: '1', memory: '512Mi', ephemeralStorage: '1Gi' };
  const plan = runtimeImageBuildPlan(build, revision, { namespace: 'cs-example', slug: 'example', repositoryUrl: 'https://git.example/repo.git' }, { clientImage: 'client:test', builderImage: 'builder:rootless', registryBase: 'registry.internal:5000', pushHost: 'registry.example', pushInsecure: false, builderResources: resources, clientResources: resources, workspaceSize: '1Gi', cacheSize: '1Gi' }, now);
  const record: BuildResourceRecord = { id: plan.resourceId, desired: 'present', phase: 'running', spec: { children: [] }, children: [], conditions: [] };
  const k8s = createFakeK8sClient(), revoked: string[] = [], inspected: string[] = [];
  let acquired = true, stopAccepted = true;
  const intents: RuntimeBuildIntents = {
    get: async () => build,
    declare: async (candidate, value) => { if (build.epoch !== candidate.epoch || build.state === 'cancelling') return false; build = { ...build, resourcePlan: value }; return true; },
    stop: async () => stopAccepted,
    addCredential: async (_id, _epoch, id) => { build = { ...build, gitCredentialIds: [...(build.gitCredentialIds ?? []), id] }; return build.state !== 'cancelling'; },
  };
  const credentials: RuntimeBuildCredentials = { issueGit: async () => ({ id: 'git-1', token: 'git-secret' }), revokeGit: async (_r, id) => { revoked.push(id); }, push: async () => ({ host: 'registry.example', username: build.id, password: 'push-secret' }), packages: async () => ({}) };
  const ledger: RuntimeBuildLedger = { get: async () => record, within: () => { throw new Error('unused'); } };
  const executor = kubernetesRuntimeImageBuildExecutor({ k8s, intents, ledger, holder: 'test', leases: { acquire: async () => acquired, renew: async () => true, release: async () => {} }, credentials, plan: async () => plan, registryBase: 'registry.internal:5000', registry: { inspect: async (reference) => { inspected.push(reference); return { repository: reference.split('@')[0]!, digest, architecture: 'linux/amd64', diffIds: [digest], user: '', entrypoint: [], command: [] }; } } });
  const metadata = (name: string) => ({ name, namespace: plan.namespace, labels: { 'crewstation.io/resource-id': plan.resourceId, 'crewstation.io/image-build': plan.buildId, 'crewstation.io/build-epoch': '1' } });
  return { k8s, executor, plan, revision, digest, metadata, record, intents, credentials, revoked, inspected, build: () => build, update: (patch: Partial<ImageBuild>) => { build = { ...build, ...patch }; }, lease: (v: boolean) => { acquired = v; }, acceptStop: (v: boolean) => { stopAccepted = v; } };
}
