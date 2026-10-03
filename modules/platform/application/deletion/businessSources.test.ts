import { expect, test } from 'bun:test';
import { ProjectIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import type { OriginalInfrastructureOrigin } from '../../ports/infrastructureOrigins';
import { businessDeletionSources } from './businessSources';

test('business original service/task witnesses preserve aliases, join both owners and reject conflicting or unavailable origins', async () => {
  const projectId = ProjectIdSchema.parse(newResourceId()), id = newResourceId(), other = ProjectIdSchema.parse(newResourceId()), calls: string[] = [];
  let runtime: OriginalInfrastructureOrigin | undefined = { complete: true, id, scope: 'project', projectIds: [projectId], revision: jsonHash('runtime') };
  const accepted = { complete: true as const, id, scope: 'project' as const, projectIds: [projectId], revision: jsonHash('accepted') };
  let mounted = true, admitted = false, granted = false;
  const sources = businessDeletionSources({ originalInfrastructureOwnership: async (kind, key, representation) => { calls.push([kind, key, representation].join(':')); return accepted; },
    assertProjectAvailable: async () => { admitted = true; }, assertProjectDeletionGrant: async () => { granted = true; } },
    { originalInfrastructureOwnership: async (_kind, key, representation) => { calls.push([key, representation].join(':')); return runtime; } },
    () => mounted ? { originalInfrastructureOwnership: async () => accepted } : undefined,
    { protectCurrentProcess: async () => { throw new Error('not called while reading ownership'); }, sweep: async () => {} });
  expect(await sources.resolve('service', 'old-service', 'legacy')).toEqual(accepted);
  expect(await sources.resolve('task', 'old-task', 'legacy')).toMatchObject({ id, projectIds: [projectId], revision: jsonHash({ runtime: runtime!.revision, accepted: accepted.revision }) });
  expect(calls).toEqual(['service:old-service:legacy', 'old-task:legacy']);
  runtime = undefined; expect(await sources.resolve('task', id, 'current')).toEqual(accepted);
  runtime = { ...accepted, projectIds: [other] }; await expect(sources.resolve('task', id, 'current')).rejects.toThrow('归属冲突');
  mounted = false; await expect(sources.resolve('task', id, 'current')).rejects.toThrow('尚未装配');
  await sources.assertAvailable(projectId); await sources.assertGrant({} as never); expect(admitted && granted).toBe(true);
});

test('business callbacks forward the configured original process and whole-Pod observer', async () => {
  const process = { podUid: newResourceId(), nodeUid: newResourceId(), nodeName: 'node', containerId: 'containerd://' + 'a'.repeat(64), pid: 1, pidNamespace: '2', bootId: newResourceId(), startTicks: '3' };
  let swept = false;
  const sources = businessDeletionSources({ originalInfrastructureOwnership: async () => undefined, assertProjectAvailable: async () => {}, assertProjectDeletionGrant: async () => {} },
    { originalInfrastructureOwnership: async () => undefined }, () => ({ originalInfrastructureOwnership: async () => undefined }),
    { protectCurrentProcess: async () => process, sweep: async (accept) => { swept = await accept.releasable(process.podUid); } });
  expect(await sources.processes.protectCurrent()).toEqual(process);
  await sources.processes.sweep({ stopped: async () => {}, podStopped: async () => {}, releasable: async () => true }); expect(swept).toBe(true);
});
