import { expect, test } from 'bun:test';
import type { ProjectId, ReleaseId, RuntimeImageExecutionSnapshot, UserId } from '@crewstation/contracts';
import { TasksSpecSchema } from '@crewstation/contracts';
import { releaseImagePorts } from './releaseImagePorts';

const id = (n: number) => `01a0bf5d-8f4b-7111-8111-${String(n).padStart(12, '0')}`;
const identity = { projectId: id(1) as ProjectId, releaseId: id(2) as ReleaseId, userId: id(3) as UserId };
const snapshot = (versionId: string): RuntimeImageExecutionSnapshot => ({ versionId, image: `registry/test@sha256:${'a'.repeat(64)}`, digest: `sha256:${'a'.repeat(64)}`, architecture: 'linux/amd64', initializer: { steps: [], env: {}, secrets: [] }, tools: [], initializerDigest: `sha256:${'b'.repeat(64)}`, validationId: id(4), selectionSource: 'configuration' });

test('发布逐个验证任务和 Agent 允许集，同一版本在不同位置保留独立用途引用', async () => {
  const reservations: unknown[] = [], confirmations: unknown[] = [], profile = id(8), versionA = id(9), versionB = id(10);
  const port = releaseImagePorts({ reserveImage: async (actor, projectId, input) => { reservations.push({ actor, projectId, ...input }); return snapshot(input.selection.runtimeImageVersionId!); }, confirmReference: async (...args) => { confirmations.push(args); } }, {
    isAdmin: async () => false, pinServiceImage: async (_repo, image) => image, resolveProfile: async (_project, selector) => { expect(selector).toEqual({ kind: 'default' }); return { id: profile, revision: 7 }; },
  });
  const tasks = TasksSpecSchema.parse({ taskProfileId: id(5), runtimeImageVersionId: versionA, allowedRuntimeImageVersionIds: [versionA, versionB], agentProfiles: [{ id: id(6), name: 'A', compute: { kind: 'default' }, runtimeImageVersionId: versionB }] });
  const references = await port.reserveTaskImages({ ...identity, tasks });
  expect(reservations).toHaveLength(3); expect(confirmations).toEqual([]);
  expect(reservations[0]).toMatchObject({ actor: { userId: identity.userId, isAdmin: false }, projectId: identity.projectId, selection: { runtimeImageVersionId: versionA }, target: { usage: 'task' }, owner: { type: 'release', id: `${identity.releaseId}:task` } });
  expect(reservations[2]).toMatchObject({ selection: { runtimeImageVersionId: versionB }, target: { usage: 'agent', profile: { profileId: profile, revision: 7 } }, owner: { id: `${identity.releaseId}:agent:${id(6)}` } });
  await port.confirmTaskImages(references); expect(confirmations).toHaveLength(3);
  expect(await port.pinBuiltImage('demo', 'registry/demo@sha')).toBe('registry/demo@sha');
});
test('没有图片绑定时不解析 Agent 默认档位；镜像能力不能静默丢掉选中的版本', async () => {
  const port = releaseImagePorts({ reserveImage: async () => undefined, confirmReference: async () => {} }, { isAdmin: async () => true, pinServiceImage: async (_repo, image) => image, resolveProfile: async () => { throw new Error('不应解析'); } });
  const tasks = TasksSpecSchema.parse({ taskProfileId: id(5), agentProfiles: [{ id: id(6), name: 'A', compute: { kind: 'default' } }] });
  expect(await port.reserveTaskImages({ ...identity, tasks })).toEqual([]);
  await expect(port.reserveTaskImages({ ...identity, tasks: { ...tasks, runtimeImageVersionId: id(9) } })).rejects.toThrow('未解析');
});
