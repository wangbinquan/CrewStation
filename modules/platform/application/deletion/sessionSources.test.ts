import { expect, test } from 'bun:test';
import { ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { sessionDeletionSources } from './sessionSources';

test('session sources use original runtime ownership and its complete task pages, preserve platform scope and forward actual project grants', async () => {
  const id = TaskIdSchema.parse(newResourceId()), projectId = ProjectIdSchema.parse(newResourceId()), representations: string[] = [];
  let platform = false, missing = false, admitted = false, granted = false;
  const sources = sessionDeletionSources({ originalInfrastructureOwnership: async (_kind, key, representation) => {
    representations.push(representation!); return missing ? undefined : { id, complete: true, scope: platform ? 'platform' : 'project', projectIds: platform ? [] : [projectId], revision: jsonHash(key) };
  }, originalProjectTaskIds: async (project, after) => { expect(project).toBe(projectId); return after ? [] : [id]; } },
  { assertProjectAvailable: async () => { admitted = true; }, assertProjectDeletionGrant: async () => { granted = true; } });
  expect(await sources.resolve(id)).toMatchObject({ id, projectIds: [projectId] });
  platform = true; expect(await sources.resolve('legacy-task')).toMatchObject({ scope: 'platform', projectIds: [] });
  missing = true; expect(await sources.resolve('missing')).toBeUndefined(); expect(representations).toEqual(['current', 'legacy', 'legacy']);
  expect(await sources.tasks(projectId, null)).toEqual([id]); expect(await sources.tasks(projectId, id)).toEqual([]);
  await sources.assertAvailable(projectId); await sources.assertGrant({} as never); expect(admitted && granted).toBe(true);
});
test('configured original process and whole-Pod observer are forwarded without inventing a physical source', async () => {
  const process = { podUid: Bun.randomUUIDv7(), containerId: 'containerd://' + 'a'.repeat(64), nodeUid: Bun.randomUUIDv7(), nodeName: 'node', pid: 1, pidNamespace: '123', bootId: Bun.randomUUIDv7(), startTicks: '12' };
  let observed = false;
  const sources = sessionDeletionSources({ originalInfrastructureOwnership: async () => undefined, originalProjectTaskIds: async () => [] },
    { assertProjectAvailable: async () => {}, assertProjectDeletionGrant: async () => {} }, { protectCurrentProcess: async () => process,
      sweep: async (accept) => { observed = await accept.releasable(process.podUid); } });
  expect(await sources.processes!.protectCurrent()).toEqual(process);
  await sources.processes!.sweep({ stopped: async () => {}, podStopped: async () => {}, releasable: async () => true }); expect(observed).toBe(true);
});
