import { describe, expect, test } from 'bun:test';
import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { dataDeletionSources } from './dataSources';
import type { OriginalInfrastructureOrigin } from '../../ports/infrastructureOrigins';

const projectId = ProjectIdSchema.parse(Bun.randomUUIDv7()), taskId = ResourceIdSchema.parse(Bun.randomUUIDv7());
const fact: OriginalInfrastructureOrigin = { complete: true, id: taskId, scope: 'project', projectIds: [projectId], revision: 'a'.repeat(64) };
describe('data public original ownership composition', () => {
  test('canonical and legacy keys use actual runtime and accepted task owners; late failure never means absent', async () => {
    const calls: unknown[][] = [];
    const sources = dataDeletionSources({ originalInfrastructureOwnership: async (kind,key,representation) => { calls.push([kind,key,representation]); return { ...fact, scope: 'project' }; }, assertProjectDeletionGrant: async () => undefined }, () => ({
      taskRuntime: { originalInfrastructureOwnership: async (kind,key,representation) => { calls.push([kind,key,representation]); return fact; } },
      businessTask: { originalInfrastructureOwnership: async () => ({ ...fact, scope: 'project' }) },
    }));
    expect(await sources.resolve('task','old-number-417')).toEqual({ complete: true, id: taskId, projectId });
    expect(await sources.resolve('service',taskId)).toEqual({ complete: true, id: taskId, projectId });
    expect(calls).toEqual([['task','old-number-417','legacy'],['service',taskId,'current']]);
    expect(await sources.reference('task',taskId)).toEqual({ complete: true, id: taskId, projectId });
    expect(await sources.reference('material-version',taskId)).toBeUndefined();
    const late = dataDeletionSources({ originalInfrastructureOwnership: async () => undefined, assertProjectDeletionGrant: async () => undefined }, () => { throw new Error('original owner unavailable'); });
    await expect(late.resolve('task',taskId)).rejects.toThrow('original owner unavailable');
  });

  test('platform, conflicting projects and canonical identities are rejected; true missing sources stay unknown', async () => {
    let runtime: OriginalInfrastructureOrigin | undefined = fact, accepted: OriginalInfrastructureOrigin | undefined = fact;
    const sources = dataDeletionSources({ originalInfrastructureOwnership: async () => undefined, assertProjectDeletionGrant: async () => undefined }, () => ({ taskRuntime: { originalInfrastructureOwnership: async () => runtime }, businessTask: { originalInfrastructureOwnership: async () => accepted && { ...accepted, scope: 'project' } } }));
    accepted = { ...fact, id: Bun.randomUUIDv7() }; await expect(sources.resolve('task',taskId)).rejects.toThrow('disagree');
    accepted = { ...fact, projectIds: [ProjectIdSchema.parse(Bun.randomUUIDv7())] }; await expect(sources.resolve('task',taskId)).rejects.toThrow('disagree');
    runtime = { ...fact, scope: 'platform', projectIds: [] }; accepted = undefined; await expect(sources.resolve('task',taskId)).rejects.toThrow('disagree');
    runtime = undefined; expect(await sources.resolve('task',taskId)).toBeUndefined();
  });
});
