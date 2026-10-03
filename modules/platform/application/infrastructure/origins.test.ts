import { describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, DomainTopic } from '@crewstation/contracts';
import type { ProjectId } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import type { InfrastructureSourceModules, OriginalInfrastructureOrigin } from '../../ports/infrastructureOrigins';
import { infrastructureOriginSources } from './origins';

const projectId = newResourceId() as ProjectId;
function fixture() {
  const calls: Array<{ owner: string; kind?: string; key: string; representation?: string }> = [];
  const project = (owner: string, key: string, representation?: string, kind?: string) => {
    calls.push({ owner, kind, key, representation });
    return { complete: true as const, id: key, scope: 'project' as const, projectIds: [projectId], revision: jsonHash({ owner, kind }) };
  };
  const platform = (owner: string, key: string, representation?: string, kind?: string) => {
    calls.push({ owner, kind, key, representation });
    return { complete: true as const, id: key, scope: 'platform' as const, projectIds: [] as const, revision: jsonHash({ owner, kind }) };
  };
  const modules: InfrastructureSourceModules = {
    project: { originalInfrastructureOwnership: async (kind, key, representation) => project('project', key, representation, kind) },
    events: { originalDeliveryOwnership: async (key, representation) => project('events', key, representation) },
    release: { originalInfrastructureOwnership: async (key, representation) => project('release', key, representation) },
    apiCatalog: { originalInfrastructureOwnership: async (key, representation) => project('api', key, representation) },
    resourceAccess: { originalInfrastructureOwnership: async (key, representation) => project('resource', key, representation) },
    agentRuntime: { originalInfrastructureOwnership: async (key, representation) => platform('profile-test', key, representation) },
    clusterManagement: { originalInfrastructureOwnership: async (kind, key, representation) => platform('cluster', key, representation, kind) },
    taskRuntime: { originalInfrastructureOwnership: async (kind, key, representation) => project('runtime', key, representation, kind) },
    businessTask: { originalInfrastructureOwnership: async (kind, key, representation) => project('business', key, representation, kind) },
    identities: { resolve: async () => undefined },
  };
  return { calls, modules, sources: infrastructureOriginSources(modules) };
}
const document = { channel: 'queue' as const, name: 'test-only-port-routing', payload: {}, legacyPayload: null, identityProvenance: null };
describe('public original infrastructure source composition (port routing only)', () => {
  test('all sixteen origin kinds route to their registered public owners, retaining the representation', async () => {
    const f = fixture(), key = newResourceId();
    const pairs = [['project', 'project'], ['service', 'project'], ['deletion', 'project'], ['delivery', 'events'], ['release', 'release'],
      ['resource-change', 'resource'], ['api-operation', 'api'], ['profile-test', 'profile-test'], ['rebuild', 'runtime'], ['parent-ending', 'runtime'],
      ['subtask', 'business'], ['cluster-refresh', 'cluster'], ['cluster-operation', 'cluster'], ['cluster-metrics', 'cluster'], ['cluster-storage', 'cluster']] as const;
    for (const [kind, owner] of pairs) {
      expect(await f.sources.resolve(document, { kind, key }, 'legacy')).toMatchObject({ id: key });
      expect(f.calls.at(-1)).toMatchObject({ owner, key, representation: 'legacy' });
    }
    const task = await f.sources.resolve(document, { kind: 'task', key }, 'current');
    expect(task).toMatchObject({ id: key, scope: 'project', projectIds: [projectId] });
    expect(f.calls.slice(-2).map((call) => call.owner)).toEqual(['runtime', 'business']);
    await expect(f.sources.resolve(document, { kind: 'unknown' as never, key }, 'current')).rejects.toThrow('未登记');
  });
  test('task sources must agree; either actual owner can supply a witness, and missing owners stay unknown', async () => {
    const f = fixture(), key = newResourceId(), original = await f.modules.taskRuntime.originalInfrastructureOwnership('task', key);
    const reference = { kind: 'task' as const, key };
    f.modules.businessTask.originalInfrastructureOwnership = async () => undefined;
    expect(await f.sources.resolve(document, reference, 'current')).toEqual(original);
    f.modules.taskRuntime.originalInfrastructureOwnership = async () => undefined;
    expect(await f.sources.resolve(document, reference, 'current')).toBeUndefined();
    f.modules.businessTask.originalInfrastructureOwnership = async () => ({ ...original!, scope: 'project', projectIds: [projectId] });
    expect(await f.sources.resolve(document, reference, 'current')).toEqual(original);
    f.modules.taskRuntime.originalInfrastructureOwnership = async () => ({ ...original!, projectIds: [newResourceId() as ProjectId] });
    await expect(f.sources.resolve(document, reference, 'current')).rejects.toThrow('归属冲突');
  });
  test('reserved profile-test references require the actual runtime source and original legacy alias', async () => {
    const f = fixture(), taskId = newResourceId();
    const input = { ...document, channel: 'event' as const, name: DomainTopic.taskCreated, payload: {
      kind: 'profile-test', taskId, projectId: BUILTIN_RESOURCES.profileTestProject, serviceId: BUILTIN_RESOURCES.profileTestService,
    } };
    const source: OriginalInfrastructureOrigin = { complete: true, id: taskId, scope: 'platform', projectIds: [], revision: jsonHash('actual platform test') };
    f.modules.taskRuntime.originalInfrastructureOwnership = async () => source;
    for (const [kind, key] of [['project', BUILTIN_RESOURCES.profileTestProject], ['service', BUILTIN_RESOURCES.profileTestService]] as const) {
      expect(await f.sources.resolve(input, { kind, key }, 'current')).toMatchObject({ id: key, scope: 'platform', projectIds: [] });
      expect(await f.sources.resolve(input, { kind, key }, 'legacy')).toEqual(await f.sources.resolve(input, { kind, key }, 'current'));
    }
    await expect(f.sources.resolve(input, { kind: 'project', key: 'platform-old' }, 'legacy')).rejects.toThrow('保留身份');
    f.modules.identities.resolve = async () => BUILTIN_RESOURCES.profileTestProject;
    expect(await f.sources.resolve(input, { kind: 'project', key: 'platform-old' }, 'legacy')).toEqual(await f.sources.resolve(input, { kind: 'project', key: BUILTIN_RESOURCES.profileTestProject }, 'current'));
    f.modules.taskRuntime.originalInfrastructureOwnership = async () => undefined;
    expect(await f.sources.resolve(input, { kind: 'project', key: BUILTIN_RESOURCES.profileTestProject }, 'current')).toBeUndefined();
    f.modules.taskRuntime.originalInfrastructureOwnership = async () => ({ ...source, scope: 'project', projectIds: [projectId] });
    expect(await f.sources.resolve(input, { kind: 'project', key: BUILTIN_RESOURCES.profileTestProject }, 'current')).toMatchObject({ scope: 'project', projectIds: [projectId] });
  });
});
