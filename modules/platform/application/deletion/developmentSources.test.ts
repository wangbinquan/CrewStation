import { expect, test } from 'bun:test';
import { ProjectIdSchema, ServiceIdSchema, UserIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { developmentDeletionSources, developmentSourceControl } from './developmentSources';

test('development Root forwards the actual owner kind, representation, project grants and protected process; missing late owner fails', async () => {
  const projectId = ProjectIdSchema.parse(newResourceId()), taskId = newResourceId();
  const origin = { complete: true as const, id: taskId, scope: 'project' as const, projectIds: [projectId], revision: jsonHash(taskId) };
  const reads: unknown[] = [], guards: unknown[] = [];
  const process = { podUid: crypto.randomUUID(), nodeUid: crypto.randomUUID(), nodeName: 'original-node', containerId: 'containerd://' + 'c'.repeat(64),
    pid: 1, pidNamespace: '34', bootId: crypto.randomUUID(), startTicks: '567' };
  const late: { cluster?: { originalInfrastructureOwnership: (kind: string, key: string, representation?: string) => Promise<typeof origin> } } = {};
  const sources = developmentDeletionSources({ originalInfrastructureOwnership: async (kind, key, representation) => { reads.push(['project', kind, key, representation]); return { ...origin, id: projectId }; },
    assertProjectAvailable: async (id) => { guards.push(id); }, assertProjectDeletionGrant: async (context) => { guards.push(context); } },
  { originalInfrastructureOwnership: async (kind, key, representation) => { reads.push(['task-runtime', kind, key, representation]); return origin; } }, () => late.cluster,
  { protectCurrentProcess: async () => process, sweep: async (accept) => { expect(await accept.releasable(process.podUid)).toBe(true); } });
  expect(await sources.resolve('project', projectId, 'current')).toMatchObject({ id: projectId });
  expect(await sources.resolve('task', 'legacy-original-task', 'legacy')).toBe(origin);
  await expect(sources.resolve('cluster-operation', 'original-operation', 'legacy')).rejects.toThrow('尚未装配');
  late.cluster = { originalInfrastructureOwnership: async (kind, key, representation) => { reads.push(['cluster-management', kind, key, representation]); return origin; } };
  expect(await sources.resolve('cluster-operation', 'original-operation', 'legacy')).toBe(origin);
  expect(reads).toEqual([['project', 'project', projectId, 'current'], ['task-runtime', 'task', 'legacy-original-task', 'legacy'], ['cluster-management', 'cluster-operation', 'original-operation', 'legacy']]);
  const grant = { original: 'grant' } as never;
  await sources.assertAvailable(projectId); await sources.assertGrant(grant); expect(guards).toEqual([projectId, grant]);
  expect(await sources.processes.protectCurrent()).toBe(process);
  await sources.processes.sweep({ stopped: async () => {}, podStopped: async () => {}, releasable: async () => true });
});

test('development source-control Root preserves the original receiver and issues only the immediate 60 minute credential response', async () => {
  const actor = { userId: UserIdSchema.parse(newResourceId()), isAdmin: true }, service = ServiceIdSchema.parse(newResourceId());
  const calls: unknown[] = [], sentinel = 'original-source-control';
  const scm = { sentinel, async listBranches(who: typeof actor, id: typeof service, compare: unknown) { expect(this.sentinel).toBe(sentinel); calls.push([who, id, compare]); return []; },
    async issueSessionCredential(id: typeof service, minutes: number) { expect(this.sentinel).toBe(sentinel); calls.push([id, minutes]);
      return { token: 'test credential/?', httpUrlWithCredentialTemplate: 'https://oauth2:{token}@git.example.test/original.git', expiresAt: '2026-10-03T15:00:00Z' }; },
    async readFile(id: typeof service, ref: string, path: string) { expect(this.sentinel).toBe(sentinel); calls.push([id, ref, path]); return 'original-file'; } };
  const port = developmentSourceControl(scm, actor), compare = { previewSha: 'original-preview' };
  expect(await port.listBranches(service, compare)).toEqual([]);
  expect(await port.pushUrl(service)).toEqual({ url: 'https://oauth2:test%20credential%2F%3F@git.example.test/original.git', expiresAt: '2026-10-03T15:00:00Z' });
  expect(await port.readFile(service, 'main', 'crewstation.yaml')).toBe('original-file');
  expect(calls).toEqual([[actor, service, compare], [service, 60], [service, 'main', 'crewstation.yaml']]);
});
