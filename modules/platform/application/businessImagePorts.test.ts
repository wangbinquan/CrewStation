import { expect, test } from 'bun:test';
import type { Actor, ProjectId, RuntimeImageExecutionSnapshot, TaskId } from '@crewstation/contracts';
import { newResourceId, PlatformError } from '@crewstation/kernel';
import { businessImagePorts } from './businessImagePorts';

test('业务任务和 Agent 使用各自 owner、允许集合与固定档位验证，不互相继承', async () => {
  type Bindings = Parameters<typeof businessImagePorts>[0];
  const reservations: Array<Parameters<Bindings['reserveImage']>> = [], confirmations: Array<Parameters<Bindings['confirmReference']>> = [];
  const copies: Array<Parameters<Bindings['copyReference']>> = [];
  const releases: Array<Parameters<Bindings['releaseReference']>> = [];
  const actor: Actor = { userId: newResourceId() as Actor['userId'], isAdmin: true };
  const digest = `sha256:${'a'.repeat(64)}`, selected: RuntimeImageExecutionSnapshot = { versionId: newResourceId(), image: `registry.test/tools@${digest}`, digest, architecture: 'linux/amd64', initializer: { steps: [], env: {}, secrets: [] }, tools: [], initializerDigest: digest, validationId: newResourceId(), selectionSource: 'request' };
  const ports = businessImagePorts({ releaseReference: async (...args) => { releases.push(args); }, reserveImage: async (...args) => { reservations.push(args); return selected; }, confirmReference: async (...args) => { confirmations.push(args); }, copyReference: async (...args) => { copies.push(args); } }, actor);
  const project = newResourceId() as ProjectId, parent = newResourceId() as TaskId, child = newResourceId() as TaskId;
  const selection = { allowedRuntimeImageVersionIds: [selected.versionId] }, profile = { profileId: newResourceId(), revision: 3 };
  expect(await ports.reserveAgent(project, child, selection, profile, selected.versionId)).toEqual(selected);
  expect(reservations[0]).toEqual([actor, project, { owner: { type: 'agent', id: child }, selection, target: { usage: 'agent', profile }, requestedVersionId: selected.versionId }]);
  await ports.confirmAgent(selected, child);
  await ports.reserveTask(project, parent, { runtimeImageVersionId: selected.versionId }); await ports.confirmTask(selected, parent);
  expect(reservations[1]![2]).toEqual({ owner: { type: 'task', id: parent }, selection: { runtimeImageVersionId: selected.versionId }, target: { usage: 'task' } });
  expect(confirmations).toEqual([[selected.versionId, { type: 'agent', id: child }], [selected.versionId, { type: 'task', id: parent }]]);
  const resumed = newResourceId() as TaskId;
  await ports.restoreAgent(project, selected, child, resumed);
  expect(copies).toEqual([[project, selected.versionId, { type: 'agent', id: child }, { type: 'agent', id: resumed }]]);
  await ports.restoreTask(project, selected, parent, resumed);
  expect(copies[1]).toEqual([project, selected.versionId, { type: 'task', id: parent }, { type: 'task', id: resumed }]);
  await ports.release(selected, { type: 'agent', id: resumed }); await ports.release(selected, { type: 'task', id: parent });
  expect(releases).toEqual([[selected.versionId, { type: 'agent', id: resumed }], [selected.versionId, { type: 'task', id: parent }]]);
  expect(await ports.inspectReference(project, { type: 'agent', id: child }, selected)).toBe(false);
  const inspections: unknown[] = [];
  const readonly = businessImagePorts({ inspectReference: async (...args) => { inspections.push(args); return true; }, reserveImage: async () => { throw new Error('read must not reserve'); }, confirmReference: async () => {}, releaseReference: async () => {}, copyReference: async () => {} }, actor);
  expect(await readonly.inspectReference(project, { type: 'agent', id: child }, selected)).toBe(true);
  expect(inspections).toEqual([[project, { type: 'agent', id: child }, selected]]);
});

// RFC-043: an upgrade compares the image identity and availability of two versions as the business service's actor.
test('运行镜像升级按版本读取所属镜像与可用状态，不存在的版本不是错误', async () => {
  const actor: Actor = { userId: newResourceId() as Actor['userId'], isAdmin: true }, project = newResourceId() as ProjectId;
  const known = newResourceId(), imageId = newResourceId(), reads: unknown[] = [];
  const unused = { reserveImage: async () => undefined, confirmReference: async () => {}, releaseReference: async () => {}, copyReference: async () => {} };
  const ports = businessImagePorts({ ...unused, getVersion: async (...args) => {
    reads.push(args);
    if (args[2] !== known) throw new PlatformError('not_found', '运行镜像版本不存在');
    return { imageId, state: 'disabled' as const };
  } }, actor);
  expect(await ports.versionImage!(project, known)).toEqual({ imageId, state: 'disabled' });
  expect(await ports.versionImage!(project, newResourceId())).toBeUndefined();
  expect(reads[0]).toEqual([actor, project, known]);
  const failing = businessImagePorts({ ...unused, getVersion: async () => { throw new PlatformError('forbidden', 'no access'); } }, actor);
  await expect(failing.versionImage!(project, known)).rejects.toMatchObject({ kind: 'forbidden' });
  expect('versionImage' in businessImagePorts(unused, actor)).toBe(false);
});
