import { expect, test } from 'bun:test';
import { ResourceIdentityMap, UUID_V7_PATTERN } from './identityMap';
import { transformIdentityDocument } from './documentTransform';

test('同后缀的旧资源及不同作用域同名资源获得不同身份，重复分配沿用映射', () => {
  const map = new ResourceIdentityMap(), suffix = 'abcd'.repeat(8);
  const task = map.allocate('task', [`tsk_${suffix}`]), agent = map.allocate('agent', [`agt_${suffix}`]);
  const first = map.allocate('config', ['project-a', 'API_KEY']), second = map.allocate('config', ['project-b', 'API_KEY']);
  expect(new Set([task.id, agent.id, first.id, second.id]).size).toBe(4);
  for (const entry of map.values()) expect(entry.id).toMatch(UUID_V7_PATTERN);
  expect(map.allocate('task', [`tsk_${suffix}`])).toEqual(task);
  expect(new ResourceIdentityMap(map.values()).resolve('config', ['project-a', 'API_KEY'])).toBe(first.id);
  expect(() => map.resolve('config', ['project-c', 'API_KEY'])).toThrow('Unresolved');
});

test('已有 UUIDv7 保留，UUIDv4 重新分配，冲突和跨类型混用明确拒绝', () => {
  const id = '019a0bf3-9ff4-7691-9aa7-43c381c573d9', map = new ResourceIdentityMap();
  expect(map.allocate('task', [id], id).id).toBe(id);
  const old = '019a0bf3-9ff4-4691-9aa7-43c381c573d9';
  expect(map.allocate('task', [old], old).id).not.toBe(old);
  expect(map.resolve('task', [id])).toBe(id);
  expect(() => map.allocate('agent', [id], id)).toThrow('Duplicate resource identity');
  expect(() => map.add({ kind: 'task', key: JSON.stringify([id]), id: '019a0bf3-9ff4-7691-9aa7-43c381c573d8' })).toThrow('Conflicting');
  expect(() => new ResourceIdentityMap([{ kind: 'task', key: '[]', id: old }])).toThrow('Invalid UUIDv7');
});

test('只转换声明的多行 JSON 引用，作用域先取原值，原始快照与业务内容保持完整', () => {
  const identities = new ResourceIdentityMap();
  const profile = identities.allocate('profile', ['small']), a = identities.allocate('step', ['small', 'file-1']), b = identities.allocate('step', ['small', 'script-1']);
  const original = { profile: 'small', steps: [{ stepId: 'file-1', name: 'copy' }, { stepId: 'script-1', name: 'run' }], payload: { profile: 'small', stepId: 'file-1' }, script: 'echo small' };
  const result = transformIdentityDocument(original, [
    { path: 'profile', kind: 'profile', rename: 'profileId' },
    { path: 'steps.*.stepId', kind: 'step', keys: ['$row.profile', '$value'], rename: 'id' },
  ], { profile: 'small' }, identities);
  expect(result).toEqual({ profileId: profile.id, steps: [{ id: a.id, name: 'copy' }, { id: b.id, name: 'run' }], payload: original.payload, script: original.script });
  expect(original.steps[0]?.stepId).toBe('file-1');
  expect(original.profile).toBe('small');
});

test('可空引用不变，未找到目标与错误键类型不能静默通过', () => {
  const identities = new ResourceIdentityMap();
  expect(transformIdentityDocument({ id: null, other: 1 }, [{ path: 'id', kind: 'task', nullable: true }], {}, identities)).toEqual({ id: null, other: 1 });
  expect(transformIdentityDocument({}, [{ path: 'missing', kind: 'task' }], {}, identities)).toEqual({});
  expect(() => transformIdentityDocument({ id: 'missing' }, [{ path: 'id', kind: 'task' }], {}, identities)).toThrow('Unresolved');
  expect(() => transformIdentityDocument({ id: {} }, [{ path: 'id', kind: 'task' }], {}, identities)).toThrow('must be a string');
});


test('typed historical fields honor parent conditions, nullable values and serialized revisions', () => {
  const ids = new ResourceIdentityMap(), release = ids.allocate('release', ['old-release']), compute = ids.allocate('compute-profile', ['same']), task = ids.allocate('task-profile', ['same']);
  const source = { resources: [{ kind: 'agent', profile: 'same' }, { kind: 'workspace', profile: 'same' }, { kind: 'unowned', profile: 'external' }], revision: JSON.stringify(['blue', 'old-release']), empty: JSON.stringify(['blue', null]) };
  expect(transformIdentityDocument(source, [
    { path: 'resources.*.profile', kind: 'compute-profile', when: { kind: ['agent', 'test'] } },
    { path: 'resources.*.profile', kind: 'task-profile', when: { kind: 'workspace' } },
    { path: 'revision', kind: 'release', serializedPath: '1' },
    { path: 'empty', kind: 'release', serializedPath: '1', nullable: true },
    { path: 'resources.*.profile', kind: 'missing', where: { eligible: 'yes' } },
  ], {}, ids)).toEqual({ resources: [{ kind: 'agent', profile: compute.id }, { kind: 'workspace', profile: task.id }, source.resources[2]], revision: JSON.stringify(['blue', release.id]), empty: source.empty });
  expect(source.resources[0]!.profile).toBe('same');
});
