import { expect, test } from 'bun:test';
import { ProjectIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { runtimeDeletionSources } from './runtimeSources';

test('runtime Root requires the real accepted business owner and preserves original kinds, representation and grant/process guards', async () => {
  const project = ProjectIdSchema.parse(newResourceId()), id = newResourceId(), origin = { complete: true as const, id, scope: 'project' as const, projectIds: [project], revision: jsonHash('original-runtime') };
  const reads: unknown[] = [], guards: unknown[] = [];
  const originalProcess = { podUid: crypto.randomUUID(), nodeUid: crypto.randomUUID(), nodeName: 'original-node', containerId: 'containerd://' + 'd'.repeat(64),
    pid: process.pid, pidNamespace: '44', bootId: crypto.randomUUID(), startTicks: '678' };
  const originalPod = { podUid: originalProcess.podUid, nodeUid: originalProcess.nodeUid, nodeName: originalProcess.nodeName };
  const late: { business?: { originalInfrastructureOwnership: (kind: string, key: string, representation?: string) => Promise<typeof origin> } } = {};
  const sources = runtimeDeletionSources({ originalInfrastructureOwnership: async (kind, key, mode) => { reads.push(['project', kind, key, mode]); return origin; },
    assertProjectAvailable: async (value) => { guards.push(value); }, assertProjectDeletionGrant: async (value) => { guards.push(value); } }, () => late.business,
  { protectCurrentProcess: async () => originalProcess, sweep: async (accept) => { await accept.podStopped?.(originalPod, jsonHash('whole-original-pod')); expect(await accept.releasable(originalProcess.podUid)).toBe(true); } });
  expect(await sources.resolve('project', project, 'current')).toBe(origin); expect(await sources.resolve('service', 'legacy-original-service', 'legacy')).toBe(origin);
  await expect(sources.resolve('business-task', id, 'current')).rejects.toThrow('尚未装配');
  late.business = { originalInfrastructureOwnership: async (kind, key, mode) => { reads.push(['business-task', kind, key, mode]); return origin; } };
  expect(await sources.resolve('business-task', 'legacy-accepted-task', 'legacy')).toBe(origin);
  const grant = { original: 'grant' } as never; await sources.assertAvailable(project); await sources.assertGrant(grant); expect(guards).toEqual([project, grant]);
  expect(await sources.processes.protectCurrent()).toBe(originalProcess); const stopped: object[] = [];
  await sources.processes.sweep({ stopped: async () => {}, podStopped: async (pod) => { stopped.push(pod); }, releasable: async () => true });
  expect(stopped).toEqual([originalPod]); expect(reads).toEqual([['project', 'project', project, 'current'], ['project', 'service', 'legacy-original-service', 'legacy'], ['business-task', 'task', 'legacy-accepted-task', 'legacy']]);
});
