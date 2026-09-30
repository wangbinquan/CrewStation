import { expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { ProjectIdSchema, ServiceIdSchema, TaskIdSchema, TraceIdSchema } from '@crewstation/contracts';
import { developmentUsageLayoutSnapshot } from './developmentUsageLayout';
import type { TaskEnvironment } from './taskEnvironment';
const id = (n: number) => '01a00000-0000-7000-8000-' + String(n).padStart(12, '0');
function environment(): TaskEnvironment {
  const at = new Date('2026-09-30T13:00:00Z'), resources = { cpu: '1', memory: '2Gi', storage: '10Gi' };
  return { id: TaskIdSchema.parse(id(3)), projectId: ProjectIdSchema.parse(id(1)), serviceId: ServiceIdSchema.parse(id(6)), kind: 'dev-session', state: 'creating', volumeMode: 'persistent', profile: id(8),
    namespace: 'cs-original', podName: 'original-agent', pvcName: 'parent-work', traceId: TraceIdSchema.parse('a'.repeat(32)), labels: {}, runnerTokenHash: 'private', connected: false,
    createdAt: at, updatedAt: at, lastActivityAt: at, render: { image: 'task:original', workerUid: 10001, resources, start: 1, developmentUsageStorage: { version: 1 } },
    native: { purpose: 'agent', parentTaskId: TaskIdSchema.parse(id(2)), parentPodUid: 'parent-instance', pvcUid: 'parent-volume', nodeName: 'worker-one', agentId: id(4), runnerId: crypto.randomUUID(), fingerprint: 'original-start',
      requestedProfile: null, profile: { id: id(8), name: 'Task resource package', ...resources }, image: 'task:original', computeProfile: { profileId: id(5), revision: 3 }, state: 'queued' } };
}
test('actual absence, legacy and selected are separate; selected metadata comes only from the child and original compute revision', () => {
  const env = environment(), legacy = { ...env, render: undefined };
  expect(developmentUsageLayoutSnapshot(env.id)).toEqual({ version: 1, executionTaskId: env.id, kind: 'absent' });
  expect(developmentUsageLayoutSnapshot(env.id, legacy)).toEqual({ version: 1, executionTaskId: env.id, kind: 'legacy' });
  const { developmentUsageStorage: _choice, ...oldRender } = env.render!;
  expect(developmentUsageLayoutSnapshot(env.id, { ...env, render: oldRender }).kind).toBe('legacy');
  const before = structuredClone(env), value = developmentUsageLayoutSnapshot(env.id, env);
  expect(value).toEqual({ version: 1, executionTaskId: env.id, kind: 'selected', layout: { version: 1 }, projectId: env.projectId, workspaceTaskId: env.native!.parentTaskId, agentId: env.native!.agentId,
    profileId: id(5), profileRevision: 3, namespace: env.namespace, podName: env.podName, podUid: null, state: 'creating', nativeState: 'queued', renderStart: 1, revision: env.updatedAt.toISOString() });
  expect(env).toEqual(before);
  for (const field of ['runnerTokenHash', 'render', 'native', 'pvcName', 'complete', 'persistedThrough', 'prompt', 'nonce']) expect(value).not.toHaveProperty(field);
  for (const patch of [{ podUid: 'child-pod' }, { native: { ...env.native!, podUid: 'child-pod' } }, { podUid: 'child-pod', native: { ...env.native!, podUid: 'child-pod' } }])
    expect(developmentUsageLayoutSnapshot(env.id, { ...env, ...patch })).toMatchObject({ kind: 'selected', podUid: 'child-pod' });
});
test('bad selected layout, missing original metadata, another execution and conflicting Pod instances never fall back to legacy or absence', () => {
  const env = environment();
  const variants: TaskEnvironment[] = [
    { ...env, kind: 'business' }, { ...env, native: undefined }, { ...env, native: { ...env.native!, purpose: undefined } },
    { ...env, native: { ...env.native!, purpose: 'cli' } }, { ...env, native: { ...env.native!, purpose: 'subtask' } },
    { ...env, native: { ...env.native!, terminalId: '' } }, { ...env, native: { ...env.native!, computeProfile: undefined } },
    { ...env, podUid: 'changed', native: { ...env.native!, podUid: 'original' } }, { ...env, podUid: '' },
    { ...env, native: { ...env.native!, computeProfile: { profileId: 'current-name', revision: 3 } } },
    { ...env, native: { ...env.native!, computeProfile: { profileId: id(5), revision: 0 } } },
    { ...env, render: { ...env.render!, start: 0 } },
    { ...env, render: { ...env.render!, developmentUsageStorage: { version: 2 } } as unknown as TaskEnvironment['render'] },
    { ...env, render: { ...env.render!, developmentUsageStorage: { version: 1, directory: '/work' } } as unknown as TaskEnvironment['render'] },
  ];
  for (const value of variants) expect(() => developmentUsageLayoutSnapshot(env.id, value)).toThrow();
  expect(() => developmentUsageLayoutSnapshot(TaskIdSchema.parse(id(9)), env)).toThrow('another execution');
  expect(() => developmentUsageLayoutSnapshot('bad' as TaskId)).toThrow();
});
